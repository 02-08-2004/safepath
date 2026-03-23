# ── SafePath Route Engine ─────────────────────────────────────────────────────
import time, logging, math, threading
from datetime import datetime
from typing import List, Optional
import networkx as nx
from safety_score import SegmentFactors, calculate_safety_score, score_to_cost

log = logging.getLogger(__name__)
_graph_cache: dict = {}
_CACHE_TTL = 7200


def prewarm_all():
    # Disabled — prewarm caused oversized query issues
    # Routes download on first request and cache for 2 hours
    log.info("Route cache ready — graphs load on first request")


def _load_graph(olat, olng, dlat, dlng):
    try:
        import osmnx as ox
    except ImportError:
        log.error("osmnx not installed")
        return None

    # Calculate distance
    dist_km = math.sqrt((olat - dlat) ** 2 + (olng - dlng) ** 2) * 111

    # Small padding — just enough to cover the route
    pad = 0.006 if dist_km < 3 else 0.010 if dist_km < 10 else 0.015

    n = round(max(olat, dlat) + pad, 4)
    s = round(min(olat, dlat) - pad, 4)
    e = round(max(olng, dlng) + pad, 4)
    w = round(min(olng, dlng) - pad, 4)
    key = f"{s},{w},{n},{e}"

    # Cache hit
    cached = _graph_cache.get(key)
    if cached and (time.time() - cached["ts"]) < _CACHE_TTL:
        log.info(f"Cache hit for {key}")
        return cached["graph"]

    # Reuse any larger cached graph
    for ck, cv in list(_graph_cache.items()):
        if (time.time() - cv["ts"]) >= _CACHE_TTL:
            continue
        parts = ck.split(",")
        if len(parts) != 4:
            continue
        cs, cw, cn, ce = map(float, parts)
        if cs <= s and cw <= w and cn >= n and ce >= e:
            log.info(f"Reusing existing graph {ck}")
            _graph_cache[key] = cv
            return cv["graph"]

    log.info(f"Downloading OSM graph — dist={dist_km:.1f}km, pad={pad}")
    try:
        # Use graph_from_point with radius instead of bbox to avoid large area issues
        center_lat = (olat + dlat) / 2
        center_lng = (olng + dlng) / 2
        # Radius in meters = half the diagonal distance + buffer
        radius = int(dist_km * 1000 / 2 + 800)
        radius = max(800, min(radius, 8000))  # between 800m and 8km

        log.info(
            f"graph_from_point center=({center_lat:.4f},{center_lng:.4f}) radius={radius}m"
        )

        G = ox.graph_from_point(
            (center_lat, center_lng),
            dist=radius,
            network_type="all",
            simplify=True,
        )
        G = ox.project_graph(G)
        _graph_cache[key] = {"graph": G, "ts": time.time()}
        log.info(f"Graph ready — {len(G.nodes)} nodes, {len(G.edges)} edges")
        return G
    except Exception as e:
        log.error(f"Graph download failed: {e}")
        return None


def _enrich(G, db_conn=None):
    hour = datetime.now().hour
    for u, v, data in G.edges(data=True):
        hw = data.get("highway", "")
        lit = data.get("lit", "")
        lighting = 90 if lit in ("yes", True) else 30 if lit in ("no", False) else 55
        crowd = (
            80
            if hw in ("pedestrian", "footway", "living_street")
            else (
                70
                if hw == "residential"
                else (
                    60
                    if hw in ("secondary", "tertiary", "unclassified")
                    else 50 if hw in ("primary", "trunk") else 45
                )
            )
        )
        crime = 0
        if db_conn:
            try:
                mlat = (G.nodes[u]["y"] + G.nodes[v]["y"]) / 2
                mlng = (G.nodes[u]["x"] + G.nodes[v]["x"]) / 2
                cur = db_conn.cursor()
                cur.execute(
                    "SELECT COUNT(*) FROM incidents WHERE ST_DWithin(geom::geography,ST_SetSRID(ST_Point(%s,%s),4326)::geography,100) AND reported_at > NOW() - INTERVAL '30 days'",
                    (mlng, mlat),
                )
                row = cur.fetchone()
                crime = row["count"] if row else 0
            except Exception:
                pass
        sc = calculate_safety_score(
            SegmentFactors(
                lighting=lighting,
                crime_incidents=crime,
                crowd_density=crowd,
                has_cctv=data.get("surveillance") == "yes",
                has_patrol=False,
                time_of_day=hour,
            )
        )
        data["safety_score"] = sc
        data["safety_cost"] = score_to_cost(sc)
        data["balanced_cost"] = data.get("length", 50) * 0.4 + score_to_cost(sc) * 40


def _nearest(G, lat, lng):
    import osmnx as ox

    try:
        import pyproj

        crs = G.graph.get("crs", "EPSG:4326")
        t = pyproj.Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        x, y = t.transform(lng, lat)
        return ox.nearest_nodes(G, x, y)
    except Exception:
        return ox.nearest_nodes(G, lng, lat)


def get_safe_routes(olat, olng, dlat, dlng, db_conn=None) -> Optional[List[dict]]:
    log.info(f"Routing: {olat:.4f},{olng:.4f} → {dlat:.4f},{dlng:.4f}")
    G = _load_graph(olat, olng, dlat, dlng)
    if G is None:
        log.error("Graph unavailable")
        return None
    try:
        _enrich(G, db_conn)
        orig = _nearest(G, olat, olng)
        dest = _nearest(G, dlat, dlng)
        if orig == dest:
            log.warning("Origin and destination map to same node")
            return None

        # Fastest — confirms connectivity
        try:
            fast_nodes = nx.shortest_path(G, orig, dest, weight="length")
        except nx.NetworkXNoPath:
            log.error("No path found between the two points")
            return None

        routes = []
        routes.append(_build(G, fast_nodes, "fast", "Fastest Route", -15))

        try:
            safe_nodes = nx.shortest_path(G, orig, dest, weight="safety_cost")
            routes.append(_build(G, safe_nodes, "safe", "Safest Route", +15))
        except Exception:
            routes.append(_build(G, fast_nodes, "safe", "Safest Route", +15))

        try:
            bal_nodes = nx.shortest_path(G, orig, dest, weight="balanced_cost")
            routes.append(_build(G, bal_nodes, "balanced", "Balanced Route", 0))
        except Exception:
            routes.append(_build(G, fast_nodes, "balanced", "Balanced Route", 0))

        order = {"safe": 0, "balanced": 1, "fast": 2}
        routes.sort(key=lambda r: order.get(r["id"], 3))
        log.info(f"Done: {[(r['name'], r['distanceKm'], 'km') for r in routes]}")
        return routes

    except Exception as e:
        import traceback

        log.error(f"Routing error: {e}\n{traceback.format_exc()}")
        return None


def _build(G, nodes, rid, name, bonus=0):
    import osmnx as ox

    Gll = ox.project_graph(G, to_crs="EPSG:4326")
    coords = [[Gll.nodes[n]["y"], Gll.nodes[n]["x"]] for n in nodes]
    scores, length = [], 0.0
    for u, v in zip(nodes, nodes[1:]):
        ed = G[u][v][0] if 0 in G[u][v] else list(G[u][v].values())[0]
        scores.append(ed.get("safety_score", 50))
        length += ed.get("length", 0)
    avg = max(5, min(100, round(sum(scores) / max(len(scores), 1)) + bonus))
    dist = round(length / 1000, 1)
    dur = round(dist / 30.0 * 60)  # 30 km/h average city driving speed
    hi = (
        ["Well-lit streets", "Safer roads", "Recommended"]
        if rid == "safe"
        else (
            ["Shortest distance", "Faster arrival"]
            if rid == "fast"
            else ["Balanced safety & speed", "Good choice"]
        )
    )
    return {
        "id": rid,
        "name": name,
        "coords": coords,
        "safetyScore": avg,
        "durationMin": dur,
        "distanceKm": dist,
        "highlights": hi,
    }
