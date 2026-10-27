# uBlock Origin (встроенное расширение ArchBrowser)

- Версия: **1.75.0** (Chromium MV2)
- Источник: <https://github.com/gorhill/uBlock/releases/tag/1.75.0>
- Лицензия: GPLv3, полный текст — `uBlock0.chromium/LICENSE.txt`.

## Изменения ArchBrowser

Electron 44 не предоставляет часть Chrome Extension API, поэтому в bundled-копию
внесены минимальные правки, чтобы background page uBlock Origin запускался:

- `js/webext.js` — защита от отсутствующих `browserAction`, `contextMenus`,
  `privacy`, `webNavigation`, `windows`; безопасные заглушки для `promisify`.
- `js/vapi-background.js` — пропуск подписок на отсутствующие `webRequest`
  navigation-события и `browserAction.onClicked`.

Дополнительно ArchBrowser сам загружает `background.html` MV2-расширения:
Electron создаёт для него `webContents`, но не открывает страницу.

`arch-build.txt` — маркер версии, по нему ArchBrowser обновляет копию
встроенного расширения в профиле пользователя.

Фильтры и блокировка `webRequest` работают; панель настроек открывается из
раздела «Расширения» (шестерёнка). Панель инструментов Chrome и контекстное
меню расширения в Electron недоступны.
