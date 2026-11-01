// The telemetry initialiser's rules (spec: Observability, Scrubbing). Every item is cleaned on
// the phone before it is sent:
//   * query strings and fragments are cut from every URL, wherever it appears;
//   * share and invite tokens in paths become ":token";
//   * user and session identifiers are removed;
//   * in the custom property bags, any property named like a person field, or a body, goes.
// Pure, so that the rules are tested without the SDK.

/** Property names that could carry a person: names, contact details, birth dates, guardians. */
const PERSON_KEY =
  /name|email|e-mail|^phone$|phone.?(number|no)|mobile|cell|birth|dob|guardian|address|relationship|givenby/i;
/** Request or response content, and free text a coach typed. */
const BODY_KEY = /body|payload|snapshot|note|comment/i;
/** Paths whose next segment is a secret: the public report page and API, and invite links. */
const TOKEN_PATH = /(\/(?:r|invite|public\/reports)\/)[^/?#\s"'<>)]+/gi;
/** An absolute URL's query string or fragment. */
const URL_QUERY = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>)]*)[?#][^\s"'<>)]*/gi;
/** A bare path's query string or fragment, at the start of the text or after a space or quote. */
const PATH_QUERY = /((?:^|[\s("'])\/[^\s?#"'<>)]*)[?#][^\s"'<>)]*/g;

export function scrubText(text: string): string {
  return text.replace(URL_QUERY, '$1').replace(PATH_QUERY, '$1').replace(TOKEN_PATH, '$1:token');
}

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Custom property bags: what the app (or the SDK) attaches as custom dimensions. */
const PROPERTY_BAGS = new Set(['properties', 'measurements', 'data', 'customProperties']);

function cleanBag(bag: Bag): void {
  for (const key of Object.keys(bag)) {
    if (PERSON_KEY.test(key) || BODY_KEY.test(key)) delete bag[key];
  }
}

function walk(value: unknown, key: string | null): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map((v) => walk(v, null));
  if (!isBag(value)) return value;
  if (key !== null && PROPERTY_BAGS.has(key)) cleanBag(value);
  for (const [k, v] of Object.entries(value)) value[k] = walk(v, k);
  return value;
}

/** Tags of the classic envelope (ai.user.id, ai.session.id and so on). */
function dropIdentityTags(tags: unknown): void {
  const each = Array.isArray(tags) ? tags : [tags];
  for (const t of each) {
    if (!isBag(t)) continue;
    for (const k of Object.keys(t)) {
      if (/^ai\.(user|session)\./.test(k) || k === 'ai.location.ip') delete t[k];
    }
  }
}

/** Cleans a telemetry item in place (the SDK's initialisers work on the item they are given). */
export function scrubItem(item: Bag): void {
  const ext = item.ext;
  if (isBag(ext)) {
    delete ext.user;
    if (isBag(ext.app)) delete ext.app.sesId;
    if (isBag(ext.device)) delete ext.device.localId;
  }
  dropIdentityTags(item.tags);
  walk(item, null);
}

/** Page views are never sent: the spec allows errors, failed API calls and named events only. */
export function isAllowedItem(item: Bag): boolean {
  const type = typeof item.baseType === 'string' ? item.baseType : '';
  return !/^Pageview/i.test(type);
}
