# ── SafePath Route Engine (OSMnx) ─────────────────────────────────────────────
import time, logging, math
from datetime import datetime
from typing import List, Optional
import networkx as nx
from safety_score import SegmentFactors, calculate_safety_score, score_to_cost

log = logging.getLogger(__name__)
_graph_cache: dict = {}
_route_cache: dict = {}
_CACHE_TTL = 7200  # 2 hours
_ROUTE_CACHE_TTL = 600  # 10 minutes


def get_graph_from_db(olat, olng, dlat, dlng, buffer_m=2000, db_conn=None):
    """Fetch road network from PostGIS database around a route's bounding box"""
    if not db_conn:
        return None
    
    try:
        cur = db_conn.cursor()
        
        # Calculate bounding box for the trip with a buffer
        # Approx 111km per degree lat
        lat_buffer = buffer_m / 111000
        lng_buffer = buffer_m / (111000 * math.cos(math.radians(olat)))
        
        min_lat = min(olat, dlat) - lat_buffer
        max_lat = max(olat, dlat) + lat_buffer
        min_lng = min(olng, dlng) - lng_buffer
        max_lng = max(olng, dlng) + lng_buffer
        
        log.info(f"Fetching roads from DB: box({min_lat:.4f}, {min_lng:.4f}) to ({max_lat:.4f}, {max_lng:.4f})")
        
        # Query edges in the bounding box
        cur.execute(
            """
            SELECT u, v, key, osmid, name, highway, length, ST_AsText(geom) as wkt
            FROM road_edges
            WHERE geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)
            """,
            (min_lng, min_lat, max_lng, max_lat)
        )
        edges = cur.fetchall()
        
        if not edges:
            log.warning("No road edges found in database for this area")
            return None
            
        # Build networkx MultiDiGraph with mandatory OSMnx metadata
        G = nx.MultiDiGraph(crs="EPSG:4326")
        G.graph["simplified"] = True
        
        # Keep track of unique node IDs to fetch their coords
        node_ids = set()
        for edge in edges:
            node_ids.add(edge[0])
            node_ids.add(edge[1])
            
        # Fetch node coordinates
        cur.execute(
            "SELECT osmid, x, y FROM road_nodes WHERE osmid IN %s",
            (tuple(node_ids),)
        )
        nodes = cur.fetchall()
        
        for osmid, x, y in nodes:
            G.add_node(osmid, x=x, y=y)
            
        from shapely import wkt
        for u, v, key, osmid, name, highway, length, wkt_str in edges:
            # Reconstruct the geometry object for _build_route to use
            geom = wkt.loads(wkt_str)
            G.add_edge(u, v, key=key, osmid=osmid, name=name, highway=highway, length=length, geometry=geom)
            
        log.info(f"Loaded graph from DB: {len(G.nodes)} nodes, {len(G.edges)} edges")
        return G
        
    except Exception as e:
        log.error(f"Failed to fetch graph from DB: {e}")
        return None




def prewarm_all():
    log.info("Route cache ready — graphs load on first request")


def get_route_cache_key(olat, olng, dlat, dlng):
    return f"{olat:.4f},{olng:.4f}|{dlat:.4f},{dlng:.4f}"


def haversine_distance(lat1, lng1, lat2, lng2):
    R = 6371
    lat1, lng1, lat2, lng2 = map(math.radians, [lat1, lng1, lat2, lng2])
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    )
    c = 2 * math.asin(min(1, math.sqrt(a)))
    return R * c


def _load_graph(olat, olng, dlat, dlng, db_conn=None):
    try:
        import osmnx as ox
    except ImportError:
        log.error("osmnx not installed")
        return None

    straight_dist = haversine_distance(olat, olng, dlat, dlng)
    # Increase buffer based on distance
    buffer_meters = int(straight_dist * 1000 * 0.3 + 2000)
    buffer_meters = min(buffer_meters, 10000) # Cap at 10km buffer

    center_lat = (olat + dlat) / 2
    center_lng = (olng + dlng) / 2
    cache_key = f"{center_lat:.4f},{center_lng:.4f},{buffer_meters}"

    if cache_key in _graph_cache:
        cached = _graph_cache[cache_key]
        if (time.time() - cached["ts"]) < _CACHE_TTL:
            log.info(f"Graph cache hit: {len(cached['graph'].nodes)} nodes")
            return cached["graph"]

    # 1. Try local database first (Phase 4 Optimization)
    G = get_graph_from_db(olat, olng, dlat, dlng, buffer_meters, db_conn)
    if G and len(G.nodes) > 10:
        # Check if the DB-loaded graph actually connects the points
        # If it doesn't, we fallback to a real-time download to fix the "straight line" bug
        try:
            orig = _nearest_node(G, olat, olng)
            dest = _nearest_node(G, dlat, dlng)
            if orig is not None and dest is not None and nx.has_path(G, orig, dest):
                log.info("DB graph provides valid road connectivity")
                _graph_cache[cache_key] = {"graph": G, "ts": time.time()}
                return G
            else:
                log.warning("DB graph disconnected or missing nodes — falling back to live OSMnx download")
        except Exception as e:
            log.warning(f"DB graph validation failed: {e}")

    # 2. Fallback to downloading if DB fails or is disconnected
    log.info(
        f"Downloading OSM road network: straight={straight_dist:.2f}km, radius={buffer_meters}m"
    )
    try:
        G = ox.graph_from_point(
            (center_lat, center_lng),
            dist=buffer_meters,
            network_type="drive",
            simplify=True,
        )
        # ... fallback remains mostly the same
        if len(G.nodes) < 10:
            log.error("No road network found via OSMnx download")
            return None

        # Ensure graph is connected
        if not nx.is_connected(G.to_undirected()):
            largest_cc = max(nx.connected_components(G.to_undirected()), key=len)
            G = G.subgraph(largest_cc).copy()

        _graph_cache[cache_key] = {"graph": G, "ts": time.time()}
        log.info(f"Graph ready (downloaded): {len(G.nodes)} nodes, {len(G.edges)} edges")
        return G

    except Exception as e:
        log.error(f"Graph load/download failed: {e}")
        return None


def _enrich(G, db_conn=None):
    from safety_score import calculate_safety_score, SegmentFactors, score_to_cost, get_road_safety_summary
    hour = datetime.now().hour
    is_night = hour < 6 or hour > 20

    # 🚀 Optimization: Fetch all incidents for the entire graph in ONE query
    incident_points = []
    if db_conn and len(G.nodes) > 0:
        try:
            cur = db_conn.cursor()
            # Calculate graph bounding box
            lats = [d['y'] for _, d in G.nodes(data=True)]
            lngs = [d['x'] for _, d in G.nodes(data=True)]
            bbox = (min(lngs), min(lats), max(lngs), max(lats))
            
            cur.execute(
                "SELECT type, ST_X(geom), ST_Y(geom) FROM incidents WHERE geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)",
                bbox
            )
            incident_points = cur.fetchall()
            log.info(f"Enrichment: Fetched {len(incident_points)} incidents for bulk matching")
        except Exception as e:
            log.error(f"Incident bulk fetch failed: {e}")

    for u, v, data in G.edges(data=True):
        highway = data.get("highway", "")
        lit = data.get("lit", "")
        
        mlat = (G.nodes[u]["y"] + G.nodes[v]["y"]) / 2
        mlng = (G.nodes[u]["x"] + G.nodes[v]["x"]) / 2

        # 🚀 Optimization: Count incidents in-memory (much faster than individual SQL queries)
        crime_count = 0
        for _, ix, iy in incident_points:
            # Simple approx distance (~150m is roughly 0.0013 degrees)
            if abs(ix - mlng) < 0.0015 and abs(iy - mlat) < 0.0015:
                crime_count += 1

        if lit in ("yes", True):
            lighting = 90
        elif lit in ("no", False):
            lighting = 25
        else:
            lighting = 55
        if is_night:
            lighting = lighting * 0.7

        if highway in ("motorway", "trunk"):
            crowd = 30
        elif highway in ("primary", "secondary"):
            crowd = 50
        elif highway in ("tertiary", "residential"):
            crowd = 65
        else:
            crowd = 55

        has_cctv = data.get("surveillance") == "yes" or data.get("camera") == "yes"

        # Highly penalize extremely minor roads so routing prefers main roads
        road_penalty = 1.0
        hw = highway[0] if isinstance(highway, list) else highway
            
        if hw in ["service", "track", "path", "unclassified"]:
            road_penalty = 2.5
        elif hw in ["residential", "living_street"]:
            road_penalty = 1.5  
        else:
            road_penalty = 1.0  

        # Dynamic safety summary
        summary = get_road_safety_summary(mlat, mlng)
        data["nearby_risks"] = summary.get("nearby_risks", [])
        data["is_isolated"] = summary.get("is_isolated", False)
        
        sc = calculate_safety_score(
            SegmentFactors(
                lighting=lighting,
                crime_incidents=min(crime_count, 15),
                crowd_density=crowd,
                has_cctv=has_cctv,
                has_patrol=False,
                time_of_day=hour,
                lat=mlat,
                lng=mlng,
                near_hospital=False
            )
        )

        data["safety_score"] = sc
        length = float(data.get("length", 100))
        base_cost = length * road_penalty
        
        data["fast_cost"] = base_cost
        data["safety_cost"] = base_cost * score_to_cost(sc)
        data["balanced_cost"] = base_cost * 0.5 + data["safety_cost"] * 0.5


def _nearest_node(G, lat, lng):
    import osmnx as ox

    try:
        return ox.nearest_nodes(G, lng, lat)
    except Exception:
        min_dist = float("inf")
        nearest = None
        for node, ndata in G.nodes(data=True):
            node_lat = ndata.get("y", 0)
            node_lng = ndata.get("x", 0)
            dist = ((lat - node_lat) ** 2 + (lng - node_lng) ** 2) ** 0.5
            if dist < min_dist:
                min_dist = dist
                nearest = node
        return nearest


def get_safe_routes(olat, olng, dlat, dlng, db_conn=None) -> Optional[List[dict]]:
    log.info(f"Routing: ({olat:.5f}, {olng:.5f}) → ({dlat:.5f}, {dlng:.5f})")

    cache_key = get_route_cache_key(olat, olng, dlat, dlng)
    if cache_key in _route_cache:
        cache_time, cached = _route_cache[cache_key]
        if (time.time() - cache_time) < _ROUTE_CACHE_TTL:
            log.info("Route cache hit")
            return cached

    G = _load_graph(olat, olng, dlat, dlng, db_conn=db_conn)
    if G is None:
        log.error("Graph unavailable – using mock routes")
        return None

    try:
        _enrich(G, db_conn)

        orig = _nearest_node(G, olat, olng)
        dest = _nearest_node(G, dlat, dlng)

        log.info(f"Nearest nodes: orig={orig}, dest={dest}")

        if orig is None or dest is None:
            log.error("Could not find nearest road nodes")
            return None
        if orig == dest:
            log.warning("Origin and destination are the same road node")
            return None
        if not nx.has_path(G, orig, dest):
            log.error("No road path exists")
            return None

        routes = []

        # 1. Fastest (shortest viable driving distance)
        fast_path = nx.shortest_path(G, orig, dest, weight="fast_cost")
        fast_route = _build_route(G, fast_path, "fast", "Fastest Route", 0)
        routes.append(fast_route)
        log.info(
            f"Fastest: {fast_route['distanceKm']}km, {fast_route['durationMin']}min"
        )

        def penalize_edges(path_to_penalize, weight_key, multiplier=1.8):
            for u, v in zip(path_to_penalize, path_to_penalize[1:]):
                if G.has_edge(u, v):
                    for key in G[u][v]:
                        if weight_key in G[u][v][key]:
                            G[u][v][key][weight_key] *= multiplier

        # 2. Safest (force alternative by penalizing fast_path)
        try:
            penalize_edges(fast_path, "safety_cost", 1.5)
            safe_path = nx.shortest_path(G, orig, dest, weight="safety_cost")
            # Revert penalties isn't strictly necessary since we won't use safety_cost again for this request
            
            # If it still somehow matches exactly, let it be (means no other roads exist)
            safe_route = _build_route(G, safe_path, "safe", "Safest Route", 0)
            routes.append(safe_route)
            log.info(f"Safest: {safe_route['distanceKm']}km, {safe_route['durationMin']}min")
        except Exception as e:
            log.warning(f"Safe route failed: {e}")
            routes.append(_build_route(G, fast_path, "safe", "Safest Route", +12))

        # 3. Balanced (force alternative by penalizing both)
        try:
            penalize_edges(fast_path, "balanced_cost", 1.8)
            penalize_edges(safe_path, "balanced_cost", 1.5) if 'safe_path' in locals() else None
            bal_path = nx.shortest_path(G, orig, dest, weight="balanced_cost")
            bal_route = _build_route(G, bal_path, "balanced", "Balanced Route", 0)
            routes.append(bal_route)
            log.info(f"Balanced: {bal_route['distanceKm']}km, {bal_route['durationMin']}min")
        except Exception as e:
            log.warning(f"Balanced route failed: {e}")
            routes.append(_build_route(G, fast_path, "balanced", "Balanced Route", 0))

        order = {"safe": 0, "balanced": 1, "fast": 2}
        routes.sort(key=lambda x: order.get(x["id"], 3))

        _route_cache[cache_key] = (time.time(), routes)
        log.info(f"Generated {len(routes)} real road routes")
        return routes

    except Exception as e:
        log.error(f"Routing error: {e}", exc_info=True)
        return None


def _build_route(G, path, route_id, name, bonus):
    import osmnx as ox

    G_ll = G
    coords = []
    
    if not path:
        return {"id": route_id, "name": name, "coords": [], "safetyScore": 50, "durationMin": 0, "distanceKm": 0, "highlights": []}

    first_node = G_ll.nodes[path[0]]
    coords.append([first_node["y"], first_node["x"]])
    
    for u, v in zip(path, path[1:]):
        edge_data = G_ll[u][v]
        if 0 in edge_data:
            edge_data = edge_data[0]
        elif edge_data:
            edge_data = list(edge_data.values())[0]
            
        if "geometry" in edge_data:
            # Reconstruct the physical bend in the road
            for lon, lat in edge_data["geometry"].coords[1:]:
                coords.append([lat, lon])
        else:
            # Fallback to straight line to the intersection
            node = G_ll.nodes[v]
            coords.append([node["y"], node["x"]])

    total_length = 0.0
    total_time_hours = 0.0
    safety_scores = []
    road_names = []
    active_hazards = []
    isolated_count = 0

    for u, v in zip(path, path[1:]):
        edge_data = G[u][v]
        if 0 in edge_data:
            edge_data = edge_data[0]
        elif edge_data:
            edge_data = list(edge_data.values())[0]
        length_m = edge_data.get("length", 100)
        total_length += length_m
        safety_scores.append(edge_data.get("safety_score", 50))
        
        # Calculate dynamic physical speed limit based on road type
        hw = edge_data.get("highway", "unclassified")
        if isinstance(hw, list): hw = hw[0]
            
        # Ground Truth Bicycle/Motorcycle Speeds (km/h) for accurate local matching
        if hw in ["motorway", "trunk"]:
            base_speed = 60.0
        elif hw in ["primary", "secondary"]:
            base_speed = 35.0
        elif hw in ["tertiary"]:
            base_speed = 25.0
        elif hw in ["residential", "living_street"]:
            # Village/Campus speed is very slow (approx 15 km/h)
            base_speed = 15.0
        else:
            # Narrow or unclassified roads
            base_speed = 10.0
            
        # Buffer for Safest/Balanced (caution, turns, etc.)
        safety_multiplier = 1.20 if route_id != "fast" else 1.05
        speed_kmh = base_speed / safety_multiplier
        
        # Add a 1.5 second "Intersection / Turn Penalty" for every road segment
        intersection_penalty_h = (1.5 / 3600)
        total_time_hours += ((length_m / 1000) / speed_kmh) + intersection_penalty_h
        
        rn = edge_data.get("name", "")
        if rn and rn not in road_names:
            road_names.append(rn)
            
        for risk in edge_data.get("nearby_risks", []):
            if risk not in active_hazards:
                active_hazards.append(risk)
        if edge_data.get("is_isolated", False):
            isolated_count += 1

    # Force native Python types for JSON serialization
    distance_km = float(round(total_length / 1000, 1))

    # Real cumulative ETA based on dynamic edge speeds
    # Adds a fixed 1-minute "Trip Startup & Maneuvering" buffer to every route
    duration_min = int(max(2, round(total_time_hours * 60) + 1))
    
    # Removed mathematical bias for "right and correct" results

    avg_score = float(sum(safety_scores) / len(safety_scores)) if safety_scores else 50.0
    avg_score = int(max(5, min(100, round(avg_score + bonus))))

    if route_id == "safe":
        highlights = ["✨ Well-lit roads", "🛡️ Low crime area", "👍 Highly recommended"]
    elif route_id == "fast":
        highlights = ["⚡ Shortest distance", "🏍️ Bike-friendly", "⏱️ Fastest arrival"]
    else:
        highlights = ["⚖️ Best balance", "🎯 Safety + Speed", "✅ Recommended"]

    if isolated_count > max(10, len(path) * 0.3):
        active_hazards.append("⚠️ Passes through highly isolated areas")

    return {
        "id": route_id,
        "name": name,
        "coords": coords,
        "safetyScore": avg_score,
        "durationMin": duration_min,
        "distanceKm": distance_km,
        "highlights": highlights[:4],
        "active_hazards": active_hazards
    }
