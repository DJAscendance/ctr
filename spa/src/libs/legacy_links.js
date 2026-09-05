/*
 * Legacy Cybertown link resolver.
 *
 * The archived 3D worlds navigate by handing Browser.loadURL() the URLs the
 * 1990s site used, either absolute against www.cybertown.com or host-relative
 * to its CGI tree. Those targets are gone, so every such control is a dead
 * button until the URL is translated into a route this application serves.
 *
 * Resolution is deliberately narrow. Only links this repository has evidence
 * for are mapped; anything else that is recognisably a legacy Cybertown link is
 * reported as unresolved so the caller can refuse it, and anything that is not
 * a legacy Cybertown link at all is passed straight through untouched.
 *
 * Nothing here may introduce a hostname. Every route produced is root-relative
 * so it works on any deployment.
 */

"use strict";

/*
 * Historical place ids used by the Mall's 3D shop doors, mapped to the slug
 * that serves the same shop today.
 *
 * Each pairing comes from the storeName field sitting beside the link in
 * assets/worlds/shopping/vrml/shopping.wrl, matched against the shop slugs the
 * already-migrated mall directory kiosk
 * (assets/externprotos/malldirectory/malldirectory.wrl) navigates to.
 *
 * The Mall's last two doors, historical ids ...901 ("Gallery") and ...916
 * ("Grocery Store"), name shops the current place list renames rather than
 * drops. The kiosk sends "Fine Art Shop" to fineartshop and "General Store" to
 * generalstore, and both places are served today, so the owner directed those
 * two doors to them.
 */
const LEGACY_PLACE_SLUGS = {
  "0000000000000901": "fineartshop", // Gallery, served today as the Fine Art Shop
  "0000000000000902": "giftshop", // Gift Shop
  "0000000000000903": "applianceshop", // Appliance Shop
  "0000000000000904": "furniturestore", // Furniture Shop
  "0000000000000905": "carpetshop", // Carpet Shop
  "0000000000000906": "gardenstore", // Garden Store
  "0000000000000907": "electronicsstore", // Electronics Store
  "0000000000000908": "noveltystore", // Novelty Store
  "0000000000000909": "toystore", // Toy Store
  "0000000000000911": "antiqueshop", // Antique Shop
  "0000000000000916": "generalstore", // Grocery Store, served today as the General Store
};

// Hosts the historical content links to for internal Cybertown destinations.
const LEGACY_HOSTS = ["cybertown.com", "www.cybertown.com"];

// The CGI tree the historical site served its internal pages from.
const LEGACY_PATH_PREFIX = "/cgi-bin/cybertown/";

/*
 * Split a URL into { host, path, query } without needing a base URL.
 * Returns null for anything that is not a string.
 */
function splitUrl(url) {
  if (typeof url !== "string" || !url) {
    return null;
  }
  let rest = url;
  let host = "";
  const match = /^https?:\/\/([^/?#]+)(.*)$/i.exec(rest);
  if (match) {
    host = match[1].toLowerCase();
    rest = match[2] || "/";
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(rest)) {
    // Some other scheme entirely (urn:, mailto:, ...). Not ours to rewrite.
    return null;
  }
  const hashAt = rest.indexOf("#");
  if (hashAt >= 0) {
    rest = rest.slice(0, hashAt);
  }
  const queryAt = rest.indexOf("?");
  const query = queryAt >= 0 ? rest.slice(queryAt + 1) : "";
  const path = queryAt >= 0 ? rest.slice(0, queryAt) : rest;
  return { host, path, query };
}

/* Read one query parameter out of a raw query string. */
function queryParam(query, name) {
  const pairs = String(query || "").split("&");
  for (let i = 0; i < pairs.length; i += 1) {
    const eq = pairs[i].indexOf("=");
    if (eq < 0) {
      continue;
    }
    if (decodeURIComponent(pairs[i].slice(0, eq)) === name) {
      return decodeURIComponent(pairs[i].slice(eq + 1));
    }
  }
  return null;
}

/*
 * Decide whether a URL is an internal Cybertown link from the archived content.
 *
 * A bare relative path is only treated as legacy when it sits under the old CGI
 * tree, so routes this application already serves are never touched.
 */
function isLegacyCybertownUrl(parts) {
  if (!parts) {
    return false;
  }
  if (parts.host) {
    return LEGACY_HOSTS.indexOf(parts.host) >= 0;
  }
  return parts.path.indexOf(LEGACY_PATH_PREFIX) === 0;
}

/*
 * Translate one historical URL.
 *
 * Returns null when the URL is not a legacy internal Cybertown link and must be
 * left exactly as it is; { route } when a proven current destination exists;
 * and { unresolved } when the link is legacy but has no destination this
 * repository can prove.
 */
function resolveLegacyUrl(url) {
  const parts = splitUrl(url);
  if (!isLegacyCybertownUrl(parts)) {
    return null;
  }

  if (parts.path.indexOf(`${LEGACY_PATH_PREFIX}place`) === 0) {
    const id = queryParam(parts.query, "ID");
    if (id && Object.prototype.hasOwnProperty.call(LEGACY_PLACE_SLUGS, id)) {
      return { route: `/#/place/${LEGACY_PLACE_SLUGS[id]}` };
    }
    return {
      unresolved: id
        ? `no current place is known for historical place id ${id}`
        : "historical place link carries no ID parameter",
    };
  }

  return { unresolved: "no mapping is known for this historical Cybertown link" };
}

module.exports = {
  LEGACY_PLACE_SLUGS,
  resolveLegacyUrl,
};
