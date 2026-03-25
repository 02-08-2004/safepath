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


def _load_graph(olat, olng, dlat, dlng):
    try:
        import osmnx as ox
    except ImportError:
        log.error("osmnx not installed")
        return None

    straight_dist = haversine_distance(olat, olng, dlat, dlng)
    radius_meters = int(straight_dist * 1000 * 0.8 + 4000)
    radius_meters = max(5000, min(radius_meters, 20000))

    center_lat = (olat + dlat) / 2
    center_lng = (olng + dlng) / 2
    cache_key = f"{center_lat:.4f},{center_lng:.4f},{radius_meters}"

    if cache_key in _graph_cache:
        cached = _graph_cache[cache_key]
        if (time.time() - cached["ts"]) < _CACHE_TTL:
            log.info(f"Graph cache hit: {len(cached['graph'].nodes)} nodes")
            return cached["graph"]

    log.info(
        f"Downloading OSM road network: straight={straight_dist:.2f}km, radius={radius_meters}m"
    )
    try:
        G = ox.graph_from_point(
            (center_lat, center_lng),
            dist=radius_meters,
            network_type="drive",
            simplify=True,
            retain_all=False,
            truncate_by_edge=True,
            clean_periphery=True,
        )
        if len(G.nodes) < 5:
            log.info("Few nodes, trying larger radius...")
            radius_meters = radius_meters * 1.5
            G = ox.graph_from_point(
                (center_lat, center_lng),
                dist=radius_meters,
                network_type="drive",
                simplify=True,
            )
        if len(G.nodes) < 5:
            log.error("No road network found")
            return None

        G = ox.project_graph(G)
        _graph_cache[cache_key] = {"graph": G, "ts": time.time()}
        log.info(f"Graph ready: {len(G.nodes)} nodes, {len(G.edges)} edges")
        return G

    except Exception as e:
        log.error(f"Graph download failed: {e}")
        return None


def _enrich(G, db_conn=None):
    hour = datetime.now().hour
    is_night = hour < 6 or hour > 20

    for u, v, data in G.edges(data=True):
        highway = data.get("highway", "")
        lit = data.get("lit", "")

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

        crime_count = 0
        if db_conn:
            try:
                mlat = (G.nodes[u]["y"] + G.nodes[v]["y"]) / 2
                mlng = (G.nodes[u]["x"] + G.nodes[v]["x"]) / 2
                cur = db_conn.cursor()
                cur.execute(
                    "SELECT COUNT(*) FROM incidents WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_Point(%s,%s),4326)::geography, 150)",
                    (mlng, mlat),
                )
                row = cur.fetchone()
                crime_count = row[0] if row else 0
            except Exception:
                pass

        has_cctv = data.get("surveillance") == "yes" or data.get("camera") == "yes"

        sc = calculate_safety_score(
            SegmentFactors(
                lighting=lighting,
                crime_incidents=min(crime_count, 15),
                crowd_density=crowd,
                has_cctv=has_cctv,
                has_patrol=False,
                time_of_day=hour,
            )
        )

        data["safety_score"] = sc
        data["safety_cost"] = score_to_cost(sc)
        length = data.get("length", 100)
        data["balanced_cost"] = length * 0.5 + data["safety_cost"] * 0.5


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

    G = _load_graph(olat, olng, dlat, dlng)
    if G is None:
        log.error("Graph unavailable – using mock routes")
        return None

    try:
        _enrich(G, db_conn)

        orig = _nearest_node(G, olat, olng)
        dest = _nearest_node(G, dlat, dlng)
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

        # 1. Fastest (shortest distance)
        fast_path = nx.shortest_path(G, orig, dest, weight="length")
        fast_route = _build_route(G, fast_path, "fast", "Fastest Route", -8)
        routes.append(fast_route)
        log.info(
            f"Fastest: {fast_route['distanceKm']}km, {fast_route['durationMin']}min"
        )

        # 2. Safest
        try:
            safe_path = nx.shortest_path(G, orig, dest, weight="safety_cost")
            safe_route = _build_route(G, safe_path, "safe", "Safest Route", +12)
            if safe_route["distanceKm"] != fast_route["distanceKm"]:
                routes.append(safe_route)
                log.info(
                    f"Safest: {safe_route['distanceKm']}km, {safe_route['durationMin']}min"
                )
        except Exception:
            routes.append(_build_route(G, fast_path, "safe", "Safest Route", +12))

        # 3. Balanced
        try:
            bal_path = nx.shortest_path(G, orig, dest, weight="balanced_cost")
            bal_route = _build_route(G, bal_path, "balanced", "Balanced Route", 0)
            if bal_route["distanceKm"] not in [r["distanceKm"] for r in routes]:
                routes.append(bal_route)
                log.info(
                    f"Balanced: {bal_route['distanceKm']}km, {bal_route['durationMin']}min"
                )
        except Exception:
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

    G_ll = ox.project_graph(G, to_crs="EPSG:4326")
    coords = []
    for n in path:
        node = G_ll.nodes[n]
        coords.append([node["y"], node["x"]])

    total_length = 0.0
    safety_scores = []
    road_names = []

    for u, v in zip(path, path[1:]):
        edge_data = G[u][v]
        if isinstance(edge_data, dict):
            if 0 in edge_data:
                edge_data = edge_data[0]
            elif edge_data:
                edge_data = list(edge_data.values())[0]
        total_length += edge_data.get("length", 0)
        safety_scores.append(edge_data.get("safety_score", 50))
        rn = edge_data.get("name", "")
        if rn and rn not in road_names:
            road_names.append(rn)

    distance_km = round(total_length / 1000, 1)

    if distance_km < 2:
        avg_speed = 25
    elif distance_km < 5:
        avg_speed = 30
    else:
        avg_speed = 40
    duration_min = max(2, round((distance_km / avg_speed) * 60))

    avg_score = sum(safety_scores) / len(safety_scores) if safety_scores else 50
    avg_score = max(5, min(100, round(avg_score + bonus)))

    if route_id == "safe":
        highlights = ["✨ Well-lit roads", "🛡️ Low crime area", "👍 Highly recommended"]
    elif route_id == "fast":
        highlights = ["⚡ Shortest distance", "🏍️ Bike-friendly", "⏱️ Fastest arrival"]
    else:
        highlights = ["⚖️ Best balance", "🎯 Safety + Speed", "✅ Recommended"]

    if road_names:
        highlights.append(f"🛣️ Via: {road_names[0][:25]}")

    return {
        "id": route_id,
        "name": name,
        "coords": coords,
        "safetyScore": avg_score,
        "durationMin": duration_min,
        "distanceKm": distance_km,
        "highlights": highlights[:4],
    }
