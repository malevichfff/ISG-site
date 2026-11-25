# ISG — Firebase + GitHub Pages

Это статический сайт: GitHub Pages публикует `index.html`, а Firebase Realtime Database хранит рабочие данные и синхронизирует изменения между посетителями в реальном времени.

## 1. Настройка Firebase

1. Откройте https://console.firebase.google.com/ и создайте проект.
2. Добавьте Web App и скопируйте `firebaseConfig`.
3. В `index.html` найдите `const firebaseConfig = { ... }` и замените значения `YOUR_API_KEY`, `YOUR_PROJECT_ID`, `YOUR_APP_ID` на значения из Firebase Console.
4. В Firebase Console откройте **Build → Realtime Database** и создайте базу.
5. Скопируйте точный `databaseURL` из настроек Realtime Database. Региональный адрес может отличаться от шаблона.
6. Откройте **Build → Authentication → Sign-in method** и включите **Anonymous**.
7. В Realtime Database → **Rules** вставьте содержимое `database.rules.json` и опубликуйте правила.

> Важно: эти стартовые правила разрешают чтение и запись любому анонимно авторизованному посетителю. Это подходит только для тестирования. Проверки ролей в HTML — это интерфейсные ограничения, а не защита базы. Перед публичным запуском нужно внедрить полноценную авторизацию и серверные правила доступа. Не храните пароли пользователей в открытом виде в Realtime Database.

## 2. Публикация через GitHub Pages

1. Создайте на GitHub новый репозиторий, например `isg-site`.
2. Загрузите в корень репозитория `index.html`, `.nojekyll`, `database.rules.json` и `README.md`.
3. Откройте **Settings → Pages**.
4. В разделе Build and deployment выберите **Deploy from a branch**, ветку `main` и папку `/ (root)`, затем сохраните.
5. Через несколько минут сайт будет доступен по адресу вида `https://ВАШ-ЛОГИН.github.io/isg-site/`.

Если репозиторий уже использует GitHub Actions для Pages, настройте Pages → Source → **GitHub Actions** и добавьте workflow из `.github/workflows/deploy.yml`.

## 3. Что хранится в Firebase

Каталоги, вкладки, отчёты и прочие рабочие данные сохраняются в узле `isg`. Сессия интерфейса остаётся локальной в браузере. Изменения из базы подписаны на realtime-обновления.

## 4. Важные замечания

- Firebase Web API key в клиентском приложении не является паролем; безопасность обеспечивают Authentication и Database Rules.
- Не публикуйте приватные ключи сервисных аккаунтов Firebase в GitHub.
- Функции администратора в текущей версии управляются логикой интерфейса. Для реальной защиты ролей потребуется серверная проверка, например Firebase custom claims и Cloud Functions.
- Если GitHub Pages подключён к кастомному домену, добавьте этот домен в Firebase Authentication → Settings → Authorized domains.
