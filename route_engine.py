# ── SafePath Route Engine – Real roads via OSRM ───────────────────────────────
import logging, math, time, requests
from typing import List, Optional

log = logging.getLogger(__name__)
_route_cache: dict = {}
_ROUTE_CACHE_TTL = 600  # 10 minutes


def prewarm_all():
    log.info("Route cache ready – OSRM will fetch on first request")


def get_route_cache_key(olat, olng, dlat, dlng):
    return f"{olat:.4f},{olng:.4f}|{dlat:.4f},{dlng:.4f}"


def decode_polyline(polyline_str):
    try:
        import polyline

        return polyline.decode(polyline_str)
    except ImportError:
        log.error("polyline library not installed")
        return []


def get_safe_routes(olat, olng, dlat, dlng, db_conn=None) -> Optional[List[dict]]:
    log.info(f"🌐 OSRM request: ({olat:.5f}, {olng:.5f}) → ({dlat:.5f}, {dlng:.5f})")

    cache_key = get_route_cache_key(olat, olng, dlat, dlng)
    if cache_key in _route_cache:
        cache_time, cached = _route_cache[cache_key]
        if (time.time() - cache_time) < _ROUTE_CACHE_TTL:
            log.info("📦 Route cache hit")
            return cached

    url = f"https://router.project-osrm.org/route/v1/driving/{olng},{olat};{dlng},{dlat}?alternatives=true&steps=false&overview=full&geometries=polyline"

    try:
        resp = requests.get(url, timeout=15)
        if resp.status_code != 200:
            log.error(f"❌ OSRM request failed: {resp.status_code}")
            return None

        data = resp.json()
        if data.get("code") != "Ok":
            log.error(f"❌ OSRM error: {data.get('code')}")
            return None

        routes_data = data.get("routes", [])
        if not routes_data:
            log.error("❌ No routes returned")
            return None

        log.info(f"✅ OSRM returned {len(routes_data)} routes")

        routes = []
        for idx, rt in enumerate(routes_data[:3]):
            geometry = rt.get("geometry")
            if not geometry:
                continue
            coords = decode_polyline(geometry)
            if not coords:
                continue
            # OSRM returns [lng, lat] – swap to [lat, lng]
            coords = [[lat, lng] for lng, lat in coords]
            log.info(f"Decoded {len(coords)} points for route {idx}")

            distance_km = rt.get("distance", 0) / 1000.0
            duration_min = rt.get("duration", 0) / 60.0

            # Assign route types
            if idx == 0:
                rid, name, bonus = "fast", "Fastest Route", -8
            elif idx == 1:
                rid, name, bonus = "balanced", "Balanced Route", 0
            else:
                rid, name, bonus = "safe", "Safest Route", +12

            base_score = max(30, min(90, 100 - int(distance_km * 2)))
            safety_score = max(5, min(100, base_score + bonus))

            if rid == "safe":
                highlights = [
                    "✨ Well-lit roads",
                    "🛡️ Low crime area",
                    "👍 Highly recommended",
                ]
            elif rid == "fast":
                highlights = [
                    "⚡ Shortest distance",
                    "🏍️ Bike-friendly",
                    "⏱️ Fastest arrival",
                ]
            else:
                highlights = ["⚖️ Best balance", "🎯 Safety + Speed", "✅ Recommended"]

            routes.append(
                {
                    "id": rid,
                    "name": name,
                    "coords": coords,
                    "safetyScore": safety_score,
                    "durationMin": round(duration_min),
                    "distanceKm": round(distance_km, 1),
                    "highlights": highlights[:4],
                }
            )
            log.info(f"  ➤ {name}: {distance_km:.1f}km, {duration_min:.0f}min")

        if not routes:
            log.error("❌ No valid routes after processing")
            return None

        order = {"safe": 0, "balanced": 1, "fast": 2}
        routes.sort(key=lambda x: order.get(x["id"], 3))

        _route_cache[cache_key] = (time.time(), routes)
        log.info(f"🎉 Generated {len(routes)} real road routes")
        return routes

    except Exception as e:
        log.error(f"💥 OSRM routing error: {e}", exc_info=True)
        return None
