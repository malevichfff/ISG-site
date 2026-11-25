// Cloudflare Worker: Mistral Vision endpoint for ISG artifact recognition.
// Set the MISTRAL_API_KEY secret in Worker Settings -> Variables and Secrets.
const ALLOWED_RARITIES = ["Мусорный", "Обычный", "Необычный", "Редкий", "Легендарный"];
const ALLOWED_STATS = [
  "stamina", "weight", "chemProtection", "gravProtection", "thermProtection",
  "elecProtection", "blood", "health", "radiation", "meleeProtection",
  "biteProtection", "hunger", "thirst", "shock"
];

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "*";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin"
      }});
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
    if (!env.MISTRAL_API_KEY) return json({ error: "На сервере не задан секрет MISTRAL_API_KEY." }, 500, origin);

    try {
      const body = await request.json();
      const image = body && body.image;
      if (typeof image !== "string" || !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(image)) {
        return json({ error: "Ожидается изображение JPEG, PNG или WEBP в формате base64." }, 400, origin);
      }
      if (image.length > 16 * 1024 * 1024) return json({ error: "Фотография слишком большая (лимит около 12 МБ)." }, 413, origin);

      const prompt = `Рассмотри изображение игрового артефакта. Извлекай данные ТОЛЬКО из текста и чисел, которые действительно видны на самой картинке. Ничего не угадывай и не используй внешние знания об игре.
Верни строго JSON-объект с полями:
{
  "name": "точное название с изображения",
  "rarity": "одно из: Мусорный, Обычный, Необычный, Редкий, Легендарный",
  "stats": {
    "stamina": число,
    "weight": число,
    "chemProtection": число,
    "gravProtection": число,
    "thermProtection": число,
    "elecProtection": число,
    "blood": число,
    "health": число,
    "radiation": число,
    "meleeProtection": число,
    "biteProtection": число,
    "hunger": число,
    "thirst": число,
    "shock": число
  }
}
В stats включай ТОЛЬКО свойства, подписи и числовые значения которых отчётливо видны на изображении. Не добавляй отсутствующие свойства, null, пустые строки, нули по умолчанию или догадки. Если подпись свойства нельзя уверенно сопоставить с одним из ключей, пропусти его.
Название перепиши точно, сохрани язык и написание с картинки. Редкость укажи только если соответствующая надпись видна на изображении и однозначно соответствует одному из пяти вариантов. Не выводи цену, тип категории или описание. Если название или редкость не видны, верни пустую строку в соответствующем поле. Никакого Markdown и текста вне JSON.`;

      const upstream = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.MISTRAL_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "mistral-small-latest",
          temperature: 0,
          max_tokens: 900,
          response_format: { type: "json_object" },
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: image }
            ]
          }]
        })
      });

      const upstreamData = await upstream.json();
      if (!upstream.ok) {
        const message = upstreamData?.message || upstreamData?.error?.message || "Ошибка API Mistral";
        return json({ error: message }, upstream.status, origin);
      }
      let content = upstreamData?.choices?.[0]?.message?.content;
      if (Array.isArray(content)) content = content.filter(x => x.type === "text").map(x => x.text).join("\n");
      if (typeof content !== "string") return json({ error: "Mistral вернул пустой ответ." }, 502, origin);

      let parsed;
      try { parsed = JSON.parse(content); }
      catch { return json({ error: "Не удалось разобрать JSON-ответ Mistral." }, 502, origin); }

      const name = typeof parsed.name === "string" ? parsed.name.trim().slice(0, 120) : "";
      const rarity = ALLOWED_RARITIES.includes(parsed.rarity) ? parsed.rarity : "";
      const stats = {};
      if (parsed.stats && typeof parsed.stats === "object") {
        for (const key of ALLOWED_STATS) {
          const value = parsed.stats[key];
          if (value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))) {
            stats[key] = Number(value);
          }
        }
      }
      return json({ name, rarity, stats }, 200, origin);
    } catch (error) {
      return json({ error: error?.message || "Внутренняя ошибка Worker." }, 500, origin);
    }
  }
};
