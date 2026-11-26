const MODEL = "@cf/qwen/qwen3.8-27b";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 10;
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const STAT_KEYS = ["stamina","weight","chemProtection","gravProtection","thermProtection","elecProtection","blood","health","radiation","meleeProtection","biteProtection","hunger","thirst","shock"];
const RARITIES = ["Мусорный","Обычный","Необычный","Редкий","Легендарный"];
const STAT_ALIASES = {
  "выносливость":"stamina","стамина":"stamina","вес":"weight",
  "химическая защита":"chemProtection","защита от химии":"chemProtection",
  "гравитационная защита":"gravProtection","защита от гравитации":"gravProtection",
  "термическая защита":"thermProtection","защита от температуры":"thermProtection",
  "электрическая защита":"elecProtection","защита от электричества":"elecProtection",
  "кровь":"blood","здоровье":"health","радиация":"radiation","защита от радиации":"radiation",
  "защита от оружия ближнего боя":"meleeProtection","защита от ближнего боя":"meleeProtection",
  "защита от укусов":"biteProtection","голод":"hunger","жажда":"thirst","шок":"shock"
};

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function json(data, status = 200, request = null) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (request) Object.assign(headers, corsHeaders(request));
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}
function prepareImage(item) {
  let base64 = item && (item.imageBase64 || item.image) || "";
  let mimeType = item && item.mimeType || "image/jpeg";
  if (typeof base64 !== "string" || !base64.trim()) throw new Error("Не передана фотография (imageBase64).");
  base64 = base64.trim();
  const dataUrlMatch = base64.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/is);
  if (dataUrlMatch) { mimeType = dataUrlMatch[1].toLowerCase(); base64 = dataUrlMatch[2]; }
  mimeType = String(mimeType).toLowerCase().trim();
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) throw new Error("Поддерживаются только JPEG, PNG и WEBP.");
  base64 = base64.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error("Некорректный формат Base64.");
  const estimatedSize = Math.floor((base64.length * 3) / 4);
  if (estimatedSize > MAX_IMAGE_BYTES) throw new Error("Фотография превышает 8 МБ.");
  if (base64.length < 20) throw new Error("Фотография слишком маленькая или повреждена.");
  return { base64, mimeType, dataUrl: "data:" + mimeType + ";base64," + base64 };
}
function extractModelText(result) {
  if (typeof result === "string") return result;
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter(x => x?.type === "text").map(x => x.text || "").join("\n");
  if (typeof result?.response === "string") return result.response;
  if (typeof result?.result?.response === "string") return result.result.response;
  throw new Error("Не удалось прочитать текстовый ответ Qwen.");
}
function extractJson(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("Qwen вернула пустой ответ.");
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(cleaned); }
  catch (_) {
    const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Qwen не вернула корректный JSON.");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}
function normalizeStatName(name) {
  if (typeof name !== "string") return null;
  const normalized = name.toLowerCase().trim().replace(/[ё]/g, "е").replace(/\s+/g, " ");
  return STAT_KEYS.includes(name) ? name : (STAT_ALIASES[normalized] || null);
}
function parseVisibleNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = value.replace(/,/g, ".").match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}
function cleanStats(rawStats) {
  const stats = {};
  if (!rawStats || typeof rawStats !== "object") return stats;
  if (!Array.isArray(rawStats)) {
    for (const [key, value] of Object.entries(rawStats)) {
      const statKey = normalizeStatName(key), number = parseVisibleNumber(value);
      if (statKey && number !== null) stats[statKey] = number;
    }
    return stats;
  }
  for (const item of rawStats) {
    if (!item || typeof item !== "object") continue;
    const statKey = normalizeStatName(item.name || item.key || item.characteristic);
    const number = parseVisibleNumber(item.value);
    if (statKey && number !== null) stats[statKey] = number;
  }
  return stats;
}
async function analyzeArtifact(env, image) {
  const systemPrompt = [
    "Ты — система оптического распознавания игровых артефактов ISG.",
    "Изучи только эту одну фотографию одного артефакта и перепиши информацию, которая действительно видна.",
    "Не объединяй её с другими фотографиями: каждый запрос относится к отдельному артефакту.",
    "Не придумывай название, редкость или характеристики. Не изменяй числа и знаки. Не заменяй отсутствующие значения нулями.",
    "Не добавляй свойства, которых нет на изображении. Если текст нельзя уверенно прочитать — пропусти его.",
    "Редкость может быть только одной из: Мусорный, Обычный, Необычный, Редкий, Легендарный. Если не видна — null.",
    "Ключи характеристик: Выносливость=stamina; Вес=weight; Химическая защита=chemProtection; Гравитационная защита=gravProtection; Термическая защита=thermProtection; Электрическая защита=elecProtection; Кровь=blood; Здоровье=health; Радиация=radiation; Защита от оружия ближнего боя=meleeProtection; Защита от укусов=biteProtection; Голод=hunger; Жажда=thirst; Шок=shock.",
    "Верни только JSON вида: { \"name\": \"Название\", \"rarity\": \"Редкий\", \"stats\": { \"stamina\": 8 } }.",
    "В stats включай только характеристики, которые видны на этой фотографии. Если название/редкость не читаются — null. Если свойств не видно — пустой объект stats."
  ].join("\n");
  const aiResult = await env.AI.run(MODEL, {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: [
        { type: "text", text: "Распознай только артефакт на этой фотографии. Верни название, видимую редкость и все читаемые характеристики. Только JSON." },
        { type: "image_url", image_url: { url: image.dataUrl } }
      ]}
    ],
    max_completion_tokens: 1200,
    temperature: 0
  });
  const parsed = extractJson(extractModelText(aiResult));
  if (!parsed || typeof parsed !== "object") throw new Error("Qwen вернула неправильную структуру.");
  const name = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim().slice(0, 150) : null;
  const rarity = RARITIES.includes(parsed.rarity) ? parsed.rarity : null;
  const stats = cleanStats(parsed.stats || parsed.characteristics);
  return { success: true, name, rarity, stats, recognizedCount: Object.keys(stats).length, model: MODEL };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (request.method === "GET") return json({
      success: true, service: "ISG Artifact AI", model: MODEL, vision: true,
      status: "online", maxImages: MAX_IMAGES, mode: "one photo = one artifact card",
      message: "Сервис распознаёт каждую фотографию отдельно."
    }, 200, request);
    if (request.method !== "POST") return json({ success: false, error: "Используйте POST-запрос." }, 405, request);
    if (!env.AI) return json({ success: false, error: "Не найден Binding AI.", details: "Проверьте Workers AI binding." }, 500, request);
    let body;
    try { body = await request.json(); }
    catch (_) { return json({ success: false, error: "Некорректный JSON в запросе." }, 400, request); }
    let inputImages = Array.isArray(body.images) ? body.images : null;
    if (!inputImages && (body.imageBase64 || body.image)) inputImages = [body];
    if (!inputImages || !inputImages.length) return json({ success: false, error: "Передайте массив images с фотографиями." }, 400, request);
    if (inputImages.length > MAX_IMAGES) return json({ success: false, error: "Можно передать не более 10 фотографий." }, 400, request);
    const artifacts = [], errors = [];
    for (let i = 0; i < inputImages.length; i++) {
      try {
        const image = prepareImage(inputImages[i]);
        const result = await analyzeArtifact(env, image);
        artifacts.push({ index: i + 1, fileName: String(inputImages[i]?.fileName || ""), ...result });
      } catch (error) {
        errors.push({ index: i + 1, fileName: String(inputImages[i]?.fileName || ""), error: error?.message || String(error) });
      }
    }
    if (!artifacts.length) return json({ success: false, error: "Не удалось распознать ни одной фотографии.", errors, model: MODEL }, 502, request);
    return json({ success: true, model: MODEL, imagesReceived: inputImages.length, artifactsCount: artifacts.length, artifacts, errors }, 200, request);
  }
};
