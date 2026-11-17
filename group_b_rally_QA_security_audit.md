# Group B — Rally Legends: QA / Security / Engineering Audit

**Дата:** 17.11.2026  
**Репозиторий:** https://github.com/Zetnovs-0/group-b-rally  
**Ветка:** `main` (просмотренная публичная версия; SHA не зафиксирован)  
**Тип:** статический *частичный* аудит с задачами для GitHub Issues / Jira  
**Аналитик:** Senior QA / AppSec review

> **Границы достоверности.** Исходники просмотрены через публичный веб-интерфейс GitHub: `README.md`, `index.html`, `package.json`, `run.sh`, `.gitignore`, `js/main.js`, а также релевантные фрагменты `js/game.js` и перечень импортируемых им модулей. Клонирование через `git` не удалось из-за недоступности сети контейнера; полный проход по всем JS-модулям, бинарному файлу `vendor/three.module.js`, истории коммитов и динамические браузерные тесты **не выполнялись**. Поэтому **не следует трактовать этот документ как подтверждение отсутствия других уязвимостей**. В каждом тикете различается *подтверждённое по коду*, *вероятный дефект* и *требует проверки*. CVE для Three.js не заявляются без идентификации точной версии.

## 1. Executive summary

Игра — клиентское 3D-приложение на **Three.js + нативных JavaScript ES modules** с WebGL, генерацией трасс, физикой автомобиля, звуком, управлением с клавиатуры/геймпада/тачскрина, сохранением рекордов и настройками в браузере. Для локального запуска используется Python `http.server`. Код организован в отдельные модули, а физический симулятор уже использует фиксированный шаг `1/120 c` — это хорошие исходные решения. Основные области риска: **состояния загрузки/перезапуска**, **стабильность симуляции при просадках FPS**, **доступность и ограничения управления**, **гигиена зависимостей**, **ошибкоустойчивость WebGL**, **качество сборки/автотестов**.

**Критичных подтверждённых удалённо эксплуатируемых уязвимостей на просмотренной поверхности не установлено.** Найдены подтверждённые паттерны, требующие исправления или оценки, и потенциальные дефекты с конкретными сценариями проверки. Приоритет P0 — блокер релиза, P1 — высокий, P2 — средний, P3 — низкий. Уровень уверенности: High/Medium/Low.

### Backlog на одну страницу

| ID | Priority | Область | Короткое название | Статус доказательства |
|---|---|---|---|---|
| QA-001 | P1 | Game lifecycle | Защитить асинхронный startStage от наложения запусков | Риск подтверждён структурой кода; воспроизведение требуется |
| QA-002 | P1 | Physics | Рассинхронизация игрового времени и физики при FPS drops | Подтверждённый паттерн |
| QA-003 | P1 | Error handling | Прекратить бесконечный цикл ошибок update() | Подтверждённый паттерн |
| QA-004 | P1 | Dependencies/AppSec | Инвентаризировать и закрепить версию Three.js | Подтверждённое отсутствие manifest-версии |
| QA-005 | P2 | AppSec | Удалить/изолировать глобальный debug API в production | Подтверждённый паттерн |
| QA-006 | P2 | AppSec | Исключить HTML sink для необязательного текста | Подтверждённый sink; эксплуатация не подтверждена |
| QA-007 | P2 | AppSec / Delivery | Ограничить локальный dev-сервер localhost | Риск конфигурации, подтверждённый запуск |
| QA-008 | P1 | Race conditions | Отменять устаревшие async stage builds | Вероятный дефект, нужна динамическая проверка |
| QA-009 | P2 | Storage | Проверить валидацию рекордов/настроек | Гипотеза; модуль не проверен полностью |
| QA-010 | P2 | WebGL | Обработка потери и восстановления WebGL context | Не подтверждено наличие обработчиков |
| QA-011 | P2 | Memory/GPU | Регрессионный тест освобождения GPU-ресурсов | Проверить, не заявлено как утечка |
| QA-012 | P2 | Release engineering | Ввести проверки в CI и минимальный test runner | Подтверждено: package scripts не содержат проверок |
| QA-013 | P2 | Controls / UX | Тесты мобильных и игровых контроллеров | Риск совместимости |
| QA-014 | P2 | Timing / Records | Валидация честности времени и восстановления | Потенциальный баг/эксплойт локального рекорда |
| QA-015 | P2 | Performance | Бюджеты объектов, draw calls, генерации и streaming | Нужны профилировочные замеры |
| QA-016 | P3 | Accessibility | Снять запрет на масштабирование страницы | Подтверждено в HTML |
| QA-017 | P2 | Lifecycle | Согласовать cleanup таймеров и событий | Риск ресурсных/логических гонок |
| QA-018 | P2 | Security headers | Добавить безопасные заголовки для production hosting | Рекомендация, не подтверждённая уязвимость |

---

## 2. Подробные задачи — готово к Issue/Jira

### QA-001 — Конкурирующие запуски этапа
- **Приоритет / тип / уверенность:** P1 / Bug, race condition / Medium.
- **Где:** `js/game.js`, `startStage()` → `await this._buildStage(...)`, `await nextFrame()` → `_beginCountdown()`; также `js/main.js`, `window.__RALLY.start()`.
- **Наблюдение:** загрузка этапа асинхронна; в доступных фрагментах нет токена актуального запуска или `AbortController`, а запуск доступен через глобальный объект. Отключение UI-кнопки не гарантирует защиты от программных/альтернативных повторных вызовов.
- **Предполагаемый сбой:** два `startStage()` могут по очереди менять `scene`, `track`, `car`, пока другая загрузка ещё выполняется. Последствия: неправильная машина/трасса, exception, неконсистентный countdown, утечка ресурсов.
- **Шаги проверки:** 1) открыть игру и DevTools; 2) вызвать `Promise.all([window.__RALLY.start('quattro','kielder'), window.__RALLY.start('quattro','kielder')])` либо две последовательные команды без ожидания; 3) повторить под CPU throttling; 4) следить за console, состоянием `game.state`, количеством сцен и VRAM.
- **Исправление:** единый `loadGenerationId`/`AbortController`, запрет нового запуска или отмена предыдущего; после **каждого** `await` проверять актуальность generation; cleanup частично созданных объектов в `finally`.
- **Acceptance criteria:** параллельные вызовы не ломают состояние; стартует максимум одна активная трасса; после 20 циклов без роста GPU/CPU memory; нет необработанных Promise rejection.
- **Автотест:** Playwright с искусственной задержкой `nextFrame` и двукратным start.

### QA-002 — Расхождение таймера и времени симуляции при низком FPS
- **Приоритет / тип / уверенность:** P1 / Gameplay correctness / High.
- **Где:** `js/main.js` `dt = Math.min(0.05, ...)`; `js/game.js` `_updateRacing`: `this.time += dt`, `physAcc += dt`, `while (physAcc >= 1/120 && steps < 12)`, `if (steps === 12) physAcc = 0`.
- **Наблюдение:** elapsed wall-clock выше 50 мс обрезается; при насыщении лимита physics steps остаток физического времени сбрасывается. Время заезда и дистанция/движение автомобиля могут масштабироваться непоследовательно при низком FPS. Утверждение о фактическом размере отклонения требует замера.
- **Проверка:** одна машина/трасса, повторяемый input; сравнить 120/60/30/15 FPS и фоновую вкладку; измерять `performance.now()`, `game.time`, пройденную дистанцию, count physics steps.
- **Исправление:** разделить wall-clock timer, simulation time и render delta; предусмотреть max catch-up, обработку пауз/visibility; документировать поведение «slow-motion under load»; тестировать детерминизм с фиксированным input replay.
- **Acceptance criteria:** игровой результат не улучшается из-за throttling; таймер согласован с выбранной моделью времени (допуск определить до реализации); physics accumulator не теряет незаметно время без телеметрии.

### QA-003 — Ошибка на каждом кадре бесконечно повторяется
- **Приоритет / тип / уверенность:** P1 / Stability / High.
- **Где:** `js/main.js`, `loop(now)` с `requestAnimationFrame(loop)` **до** `try { game.update(dt) } catch { console.error(err) }`.
- **Наблюдение:** при постоянном сбое обновления следующий кадр запланирован независимо от исключения. Может засорять консоль, расходовать CPU и оставить экран в нерабочем состоянии.
- **Проверка:** через тестовый fault injection заставить `game.update()` бросать ошибку; измерить частоту логов и поведение UI.
- **Исправление:** централизованный fatal-error state с rate-limited telemetry, остановкой/переключением игрового цикла и понятной ошибкой/кнопкой перезапуска. Не скрывать исключение повторным бесконечным логированием.
- **Acceptance criteria:** не более одного (или ограниченного числа) отчётов на одно событие; безопасное восстановление; управление и аудио переводятся в корректное состояние.

### QA-004 — Отсутствует управляемый реестр зависимостей
- **Приоритет / тип / уверенность:** P1 / Supply chain / High.
- **Где:** `package.json`, `index.html` importmap на `./vendor/three.module.js`; `vendor/three.module.js`.
- **Наблюдение:** в `package.json` нет `dependencies`/`devDependencies`, `package-lock.json` не показан в корне; Three.js поставляется как vendored JS. Это **не доказывает** устаревшую или уязвимую версию, но затрудняет CVE matching, licensing/SBOM и воспроизводимые обновления.
- **Шаги:** установить version/revision по содержимому vendor (по заголовку, `REVISION` экспортам либо hash); сопоставить с официальным release; провести CVE/OSV/GHSA scan именно **этой версии**; задокументировать происхождение файла.
- **Исправление:** выбрать один вариант: (A) управляемый `three` dependency + lockfile + Vite; (B) оставить vendor, но добавить `THIRD_PARTY_NOTICES.md`, точный version+SHA256, процедуру обновления и SBOM. Убрать двусмысленность между runtime importmap и build manifest.
- **Acceptance criteria:** известна точная версия Three.js, есть source/лицензия/hash; reproducible install/build; автоматический advisory scan; обновление зависимости можно проверить регрессиями WebGL.

### QA-005 — Глобальные отладочные интерфейсы в runtime
- **Приоритет / тип / уверенность:** P2 / Hardening / High.
- **Где:** `js/main.js`, `window.__RALLY = { game, start(...) }`; `js/game.js`, `window.__GAME = this`.
- **Наблюдение:** любой JS, выполняемый в origin страницы, получает прямой доступ к игровому объекту и изменению состояния. В standalone client-side игре это **не** само по себе remote-code-execution и не является доказательством серверного bypass; но это снижает защиту рекордов и может нарушить стабильность.
- **Исправление:** включать test hooks только в dev/test (`import.meta.env.DEV` или явный dev flag) и expose минимальный интерфейс без полного `game`; серверные рейтинги (если появятся) никогда не доверяют клиенту.
- **Acceptance criteria:** production build не экспортирует игровые mutable объекты на `window`; e2e тесты используют условный test API.

### QA-006 — HTML sink в функции отображения ошибки
- **Приоритет / тип / уверенность:** P2 / Defense-in-depth / High (sink), Low (эксплуатация).
- **Где:** `js/main.js`, `fail(message)` использует `el.innerHTML = ... ${message} ...`.
- **Наблюдение:** `message` на просмотренных call sites — статические строки; **XSS в текущем потоке данных не подтверждён**. Риск появится, если туда начнёт попадать текст ошибки, параметр URL или пользовательский контент.
- **Исправление:** создать контейнер через DOM API и вставлять `message` через `textContent` (или жёсткую sanitization policy, если HTML необходим).
- **Acceptance criteria:** test string `<img src=x onerror=alert(1)>` отображается текстом без выполнения; статическая бренд-разметка сохранена.

### QA-007 — Dev HTTP server может слушать все сетевые интерфейсы
- **Приоритет / тип / уверенность:** P2 / Local exposure / High.
- **Где:** `run.sh`, `python3 -m http.server "$PORT"`; `package.json` scripts `python3 -m http.server 8080`.
- **Наблюдение:** без `--bind 127.0.0.1` сервер Python обычно слушает все интерфейсы; пользователь может открыть содержимое каталога с другого устройства в локальной сети, если firewall разрешает. Это **не** production server и не доказательство публичной экспозиции.
- **Исправление:** `python3 -m http.server "$PORT" --bind 127.0.0.1`; добавить явный opt-in `HOST=0.0.0.0` для LAN debugging; не использовать `http.server` для публичного деплоя.
- **Acceptance criteria:** дефолтный запуск доступен только с localhost, LAN-доступ только при явном запросе; README описывает модель риска.

### QA-008 — Неполная отмена сборки при выходе/смене стадии
- **Приоритет / тип / уверенность:** P1 / Async lifecycle / Medium.
- **Где:** `js/game.js`, `startStage`, `_buildStage`: последовательность `await nextFrame()`, `await track.buildTerrain(...)`, новые присваивания `this.scene`, `this.track`; `quitToMenu()` вызывает `_disposeStage()`.
- **Наблюдение:** после `await` работа может продолжиться, даже если stage устарел; в изученном участке не видно cancellation fencing. UI может запрещать выход в момент загрузки — это надо проверить в браузере.
- **Шаги:** CPU throttle, начать загрузку, попытаться вернуться в меню/запустить новую стадию/сменить настройки или сделать навигацию; зафиксировать результаты после каждого await.
- **Исправление:** единый cancellable loading state, resource ownership per load, idempotent dispose; запрет состояния `countdown`, если generation уже не актуален.
- **Acceptance criteria:** устаревший load никогда не отображает countdown и не подменяет текущую сцену.

### QA-009 — Валидация localStorage и совместимость схем
- **Приоритет / тип / уверенность:** P2 / Data integrity / Low.
- **Где:** функции `getBest`, `setBest`, `getEndlessBest`, `setEndlessBest` импортируются из `js/config.js`; `js/game.js` использует `localStorage` ключ `gbr.mobile.tuned`.
- **Наблюдение:** локальное хранилище используется; логика всех записей и чтений **не была полностью проверена**. Это чек-лист на потенциальное повреждение данных, а не подтверждённый дефект.
- **Шаги:** заполнить localStorage невалидным JSON, отрицательными/NaN/Infinity временами, сверхдлинными строками, блокировать storage, протестировать старые версии формата; затем начать заезд.
- **Исправление:** schema validation и versioning, безопасные fallback, try/catch для quota/security errors, миграция предыдущих версий и ограничение объёма.
- **Acceptance criteria:** повреждённые значения не ломают старт/результаты; некорректные рекорды игнорируются; очистка записей работает.

### QA-010 — WebGL context loss / restoration
- **Приоритет / тип / уверенность:** P2 / Reliability / Low.
- **Где:** `js/main.js` создаёт `THREE.WebGLRenderer`, но в просмотренном фрагменте нет обработчиков `webglcontextlost`/`webglcontextrestored`.
- **Наблюдение:** обработчики могут находиться в других модулях; полный поиск не проводился.
- **Шаги:** Playwright/Chrome DevTools `WEBGL_lose_context`, переключение вкладок/GPU process crash, проверка фоновой музыки и восстановления.
- **Исправление:** явная стратегия: pause + overlay + restore or soft reload; пересоздать GPU ресурсы, если не восстановлены движком.
- **Acceptance criteria:** нет бесконечных exception; пользователю показана причина и путь восстановления.

### QA-011 — GPU memory/resource lifecycle при смене стадий
- **Приоритет / тип / уверенность:** P2 / Performance / Medium.
- **Где:** `js/game.js` `_disposeStage()` и `disposeObject` из `js/util.js`; `Track` streaming; `PostFX`, `WeatherFX`, `DestructionSystem`.
- **Наблюдение:** механизм очистки явно предусмотрен, поэтому **объявлять GPU leak без измерений нельзя**. Стоит проверить, что все geometries, textures, materials, render targets, audio nodes, listeners, таймеры освобождаются.
- **Шаги:** 30 последовательных переключений стадий и 15 минут ENDLESS; снимать `renderer.info.memory`, `renderer.info.render.calls`, heap snapshots; сравнивать после GC и возврата в меню.
- **Исправление:** системный `dispose()` contract для каждого подсистемного объекта, ref-count shared resources, тесты на стабильность memory after warmup.
- **Acceptance criteria:** нет монотонного роста после прогрева, установлены platform-specific бюджеты CPU/GPU memory.

### QA-012 — CI, lint, static check и тестовый набор
- **Приоритет / тип / уверенность:** P2 / Quality engineering / High (отсутствуют scripts).
- **Где:** `package.json` содержит только `start` и `serve`; в видимом корне нет `.github/workflows`.
- **Наблюдение:** нельзя из одного manifest сделать вывод, что тестов нигде нет; но стандартный `npm test`/`npm run lint` не определён.
- **Исправление:** ESLint, Prettier, JS/TS check, Vitest для pure functions, Playwright smoke tests и GitHub Actions workflow; включить проверку licenses/advisories. Зафиксировать browser support matrix.
- **Acceptance criteria:** PR не сливается при failed lint/unit/smoke; отчёты доступны как artifacts; unit tests проверяют collisions, seed determinism и сохранение рекордов.

### QA-013 — Управление и responsive input: тест-матрица
- **Приоритет / тип / уверенность:** P2 / UX / Medium.
- **Где:** `index.html` touch controls и help; `js/main.js` `pointer: coarse`/`maxTouchPoints`; `js/game.js` модули `Input`, `TouchControls`.
- **Наблюдение:** coarse-pointer detection может включить touch-mode на гибридных ноутбуках; UI обещает keyboard/gamepad/touch. Корректность simultaneous inputs требует проверки.
- **Тесты:** keyboard с потерей фокуса, геймпад disconnection/reconnect, оси с drift, mobile landscape/portrait, touchcancel, 2+ simultaneous pointer inputs, pause/resume, virtual keyboard/screen resize.
- **Исправление:** единое управление событиями input source с приоритетами, dead zones и reset on blur/disconnect.
- **Acceptance criteria:** никакие педали/руль не остаются «зажатыми» после loss of focus/touchcancel; пересечение контроллеров не ломает игровой процесс.

### QA-014 — Корректность локального рейтинга при Recover / FPS throttling
- **Приоритет / тип / уверенность:** P2 / Game economy / Medium.
- **Где:** `js/game.js` `recoverCar()` вызывает `physics.resetToTrack(this.track); this.time += 3;`, в гонке `time += dt`.
- **Наблюдение:** механика +3 секунды есть; при recovery нужно проверить отсутствие teleports вперёд, пропуска checkpoints и повторного начисления. Клиентский localStorage не может обеспечивать защищённый anti-cheat — это отдельное архитектурное ограничение, не security vulnerability текущей офлайн-игры.
- **Тесты:** 10 recover подряд, на старте, у финиша, в ENDLESS, во время касания препятствия, при низком FPS; проверка checkpoint progression.
- **Исправление:** фиксировать допустимые точки recovery и штрафы, инварианты finish-validation; отделить casual local record от потенциальных сетевых leaderboard.
- **Acceptance criteria:** нельзя улучшить результат recovery-спамом/понижением FPS; finish корректно определяется.

### QA-015 — Производительность генерации и streaming в ENDLESS
- **Приоритет / тип / уверенность:** P2 / Performance / Medium.
- **Где:** README заявляет chunk streaming ~200 м, 2D terrain tile streaming; `js/game.js` вызывает `track.streamEndless(this.physics.pos)` в racing и countdown.
- **Наблюдение:** реализация и пороги pruning не были измерены; тестирование должно подтверждать README claims.
- **Шаги:** 30/60 минут движения, постоянное движение оффроуд, быстрые развороты, телепорт/recovery на границах chunk; profiling on low/mid/high devices.
- **Исправление:** телеметрия `chunkCount`, `tileCount`, `meshes`, `drawCalls`, `triangleCount`, frame time p95/p99; лимиты генерации за кадр, pooling, prefetch и backpressure.
- **Acceptance criteria:** число live chunks/tiles ограничено; нет пропадающих дорог и фризов > заданного бюджета; FPS p95 согласован с profile.

### QA-016 — Запрет browser zoom
- **Приоритет / тип / уверенность:** P3 / Accessibility / High.
- **Где:** `index.html`, viewport `maximum-scale=1, user-scalable=no`.
- **Наблюдение:** HTML запрещает пользовательское масштабирование, ухудшая доступность на мобильных устройствах.
- **Исправление:** удалить ограничители масштабирования; для canvas/touch gestures использовать scoped CSS и `touch-action`, не блокируя zoom всей страницы.
- **Acceptance criteria:** пользователь может масштабировать UI; touch gameplay сохраняет управляемость; проверка WCAG 1.4.4.

### QA-017 — Таймеры жизненного цикла, уничтожение объекта и таймер загрузки
- **Приоритет / тип / уверенность:** P2 / Stability / Medium.
- **Где:** `js/game.js` `_hintTimer`, `_countdownTimer`, `setTimeout`; `quitToMenu()` очищает `_countdownTimer`; `_go()` устанавливает оба.
- **Наблюдение:** видимые участки очищают часть таймеров. Нужно проверить все paths (`quit`, `restart`, `next`, `fail`) и отсутствие callbacks старой стадии; факт дефекта не установлен.
- **Шаги:** перезапуск во время countdown, немедленный quit после GO, смена стадии до timeout, 100 циклов; таймеры под fake clocks.
- **Исправление:** единый `TimerRegistry`, `clearAll()` в stage teardown; асинхронные callbacks привязаны к generation-id.
- **Acceptance criteria:** callback старой стадии не изменяет UI новой стадии; после quit нет активных stage-scoped timeouts.

### QA-018 — Production security headers & deployment contract
- **Приоритет / тип / уверенность:** P2 / Hardening / Low (деплой не изучен).
- **Где:** статический `index.html`, runtime importmap, локальный dev server; конфигурация production hosting не проверена.
- **Наблюдение:** CSP, `X-Content-Type-Options`, `Referrer-Policy` и другие заголовки задаются **хостингом**, а не `package.json`; их отсутствие не доказано. Inline `script type=importmap` усложняет строгую CSP.
- **Исправление:** production host на HTTPS; CSP с `script-src 'self'` плюс безопасный hash/nonce importmap (протестировать CSP в целевых браузерах), `object-src 'none'`, `base-uri 'none'`, `frame-ancestors` по необходимости, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`; не устанавливать `unsafe-inline` без обоснования.
- **Acceptance criteria:** CSP Report-Only → enforced без нарушения запуска Three.js; security header smoke tests на реальном URL; отсутствие внешних неучтённых ресурсов.

---

## 3. Зависимости и архитектура

### 3.1 Runtime and build dependency inventory

| Компонент | Роль / связь | Что подтверждено | Версия/лицензия | Рекомендация |
|---|---|---|---|---|
| **Three.js** | 3D сцена, WebGL renderer, геометрия, материалы, камера, post-processing | importmap `"three": "./vendor/three.module.js"` в `index.html`; `import * as THREE from 'three'` в `main.js`, `game.js` | **Не установлена** по просмотренным фрагментам; необходимо извлечь из vendor-файла | Закрепить версию, SBOM, SHA256, проверку advisory и регрессию при обновлении |
| **JavaScript ES modules** | Native module graph | `<script type="module" src="js/main.js">`; `package.json` `"type":"module"` | Браузерная платформа | Указать поддерживаемые версии браузеров, тестировать module loading |
| **Python 3 stdlib `http.server`** | Локальная раздача статики | `run.sh`, `npm start`, `npm run serve` | Версия Python не закреплена | Только dev, bind loopback, production — специализированный static host |
| **npm** | Необходим только для команд scripts; runtime пакеты не объявлены | `package.json`: `name`, `version`, `private`, `type`, `scripts`; секций dependencies нет | Версию Node/npm не закрепили | `.nvmrc`/`engines`, lockfile при переходе на npm-managed libraries |
| **WebGL / Canvas** | Rendering | `THREE.WebGLRenderer`, два canvas `#gl`, `#glass-fx` | Зависит от браузера/GPU | Контекст loss/recovery, capability checks, graceful fallback |
| **Web Audio / browser audio** | Двигатель, речь и эффекты | модуль `AudioEngine` импортируется в `game.js` | Нативный browser API (детали реализации не изучены) | AudioContext lifecycle, autoplay restrictions, suspend/resume |
| **localStorage** | Лучшие результаты, настройки / mobile tuned flag | импорт `getBest` / `setBest` и аналогов, `localStorage` в `game.js` | Нативный browser API | Validation, migration, QuotaExceededError, no anti-cheat trust |
| **Gamepad / Pointer / Touch** | Контроллеры | `Input`, `TouchControls`, touch markup, help | Нативные browser API | Адаптация dead zones, disconnect, pointercancel |
| **GitHub Actions / test tools** | Автоматизация качества | Не видны в просмотренном корне; npm scripts lint/test отсутствуют | Не установлено | Внедрить CI pipeline и локальные проверки |

**Важно:** в действительности vendor-файл может содержать конкретную revision Three.js, но в выполненном исследовании его содержимое не удалось получить целиком. Поэтому **нельзя утверждать**, что найдена уязвимая версия, и нельзя выпускать CVE report без fingerprinting. Аналогично, отсутствие `npm dependencies` не означает отсутствие **vendored** third-party code.

### 3.2 Карта модулей, выведенная из реальных import statements

```text
index.html
  ├── css/style.css
  ├── vendor/three.module.js        <-- importmap alias "three"
  └── js/main.js
       ├── three
       └── js/game.js
            ├── config.js          [STAGES, records, conditions, camera modes]
            ├── util.js            [math helpers, nextFrame, disposeObject]
            ├── ui.js              [menus, settings, results]
            ├── menuPreview.js      [menu 3D scene]
            ├── input.js            [keyboard / gamepad]
            ├── audio.js            [engine / speech]
            ├── track.js            [track + surface / stream]
            ├── carModel.js         [3D cars]
            ├── physics.js          [vehicle dynamics]
            ├── cockpit.js          [dashboard / cockpit]
            ├── weather.js          [weather visuals]
            ├── effects.js          [lights / windscreen]
            ├── touch.js            [mobile controls]
            ├── postfx.js           [post-processing]
            └── destruction.js      [destructible scenery]
```

Эта схема показывает только **прямые импорты `game.js`**, а не полную transitive dependency tree. Полный граф следует построить автоматическим парсером imports после клонирования.

### 3.3 Предлагаемый способ управлять зависимостями

1. **Получить baseline:** `git rev-parse HEAD`, SHA256 для `vendor/three.module.js`, точную revision и лицензию.
2. **Создать SBOM:** CycloneDX/SPDX, включая vendored зависимость (иначе npm-only scanners её могут пропустить).
3. **Supply chain:** Dependabot/Renovate для manifest-managed dependencies; для vendor — регулярное ручное сравнение с upstream и security advisory.
4. **Воспроизводимость:** lockfile, `npm ci`, зафиксировать поддерживаемый Node LTS. Не добавлять сборщик только «ради моды»: сначала оценить прирост testability, bundling, code splitting, cache hashes и CSP.
5. **Update gate:** smoke на все 11 стадий, все автомобили, выбор настроек, шейдеры, WebGL1/2 ограничения, smoke on Safari/Firefox/Chrome, GPU performance regressions.

---

## 4. Предложения по улучшению кодовой базы

### Architecture
- Разделить `Game` как orchestrator/state machine от загрузки ресурсов (`StageLoader`), физического ticking (`SimulationClock`), persistence (`RecordStore`), render lifecycle (`RenderPipeline`) и input router. Сейчас `js/game.js` имеет **1269 строк**, управляет сценой, UI, таймерами, физикой и состояниями; разбиение снизит риск гонок и улучшит тестируемость.
- Ввести формализованные переходы `menu → loading → countdown → racing → paused/finishing → finished → menu` и guards для недопустимых действий.
- Все `async` ресурсоёмкие операции должны принимать `AbortSignal` и возвращать owned `StageResources`, которые гарантированно закрываются через `dispose()`.
- Чистые вычисления physics, grip, race timing и procedural generation отделить от DOM/Three.js; внедрить repeatable seed и deterministic replay.

### Development quality
- ESLint (`no-floating-promises` при TS/type checking, no-unused-vars, eqeqeq), Prettier, JSDoc или постепенный TypeScript `checkJs`; module boundary rules.
- Применить unit tests к `clamp`, интерполяции, поверхностному grip, checkpoint tracking, seed-based geometry generation, рекордам.
- E2E smoke: загрузка каждой стадии, старт/пауза/продолжение/restart/quit, переключение авто, WebGL disabled, нет console errors.
- Performance test baselines: frame time p50/p95/p99, CPU heap, GPU allocations, draw calls and live chunks; измерять после прогрева, отдельно для medium/low devices.

### Secure delivery
- Для production исключить mutable global debug hooks, настроить HTTPS/CSP/security headers, не раздавать файлы проекта через Python dev server из доступной сети.
- Для локальных рекордов обеспечить data integrity от случайной порчи. **Не обещать anti-cheat для клиента без доверенного сервера**.
- Добавить `SECURITY.md` (куда сообщать проблемы), `CONTRIBUTING.md`, `LICENSE` и отдельные notices для vendored third-party libraries после проверки условий лицензии.

---

## 5. Тест-план для подтверждения и расширения аудита

| Набор | Важные кейсы | Инструменты | Выходной артефакт |
|---|---|---|---|
| Security/SCA | SHA/version vendor, known advisories, license, secrets scan | osv-scanner, gitleaks, Syft | SBOM + dependency vulnerability report |
| Gameplay | 11 stages × cars × game modes, resets, finish, off-road recovery | Playwright + manual driving | case matrix, failing replays |
| Physics | 120/60/30/15 FPS; pause; background; deterministic input | headless harness, throttling | time/distance divergence plots |
| Lifecycle | Double-start, stage change during load, repeated quit/restart | Playwright race tests | screenshots + console logs |
| WebGL | context loss, resize, rotation, pixel ratio, GPU blacklisting | browsers / DevTools | cross-browser compatibility report |
| Performance | 30/60-minute ENDLESS, streaming boundaries, objects disposed | Chrome profiler + `renderer.info` | heap/VRAM/draw calls trend |
| Controls | keyboard/gamepad/touch, blur, disconnect, multitouch | real devices + browser tests | compatibility matrix |
| Storage | malformed/corrupt records, storage disabled, quota | Playwright localStorage fixture | recovery/validation report |
| Accessibility | zoom, focus, labels, keyboard UI, responsive overlays | axe-core + manual | accessibility defect log |

### Suggested Definition of Done (для каждого тикета)
1. Зафиксирована версия/коммит и способ воспроизведения до исправления.
2. Есть root cause, минимальный regression test и связанный PR.
3. Проверены 11 стадий + ENDLESS; нет console errors, state transitions не нарушены.
4. Сохранён baseline FPS/memory, если код затрагивает rendering, streaming или physics.
5. Обновлены README/architecture notes, если изменился developer workflow или публичное поведение.

### Порядок выполнения

**Sprint 1 — Stability & supply chain:** QA-001, QA-002, QA-003, QA-004, QA-008.  
**Sprint 2 — Observability & regressions:** QA-011, QA-012, QA-014, QA-015, QA-017.  
**Sprint 3 — Hardening & compatibility:** QA-005, QA-006, QA-007, QA-009, QA-010, QA-013, QA-016, QA-018.

Приоритет Sprint 1 следует откорректировать после фактического запуска и оценки воспроизводимости; указанная последовательность — инженерная рекомендация, а не оценка гарантированной частоты сбоев.

---

## 6. Источники и прямая привязка к коду

- Репозиторий и описание механик: https://github.com/Zetnovs-0/group-b-rally
- Entry point + importmap + viewport: https://github.com/Zetnovs-0/group-b-rally/blob/main/index.html
- Dependencies/scripts manifest: https://github.com/Zetnovs-0/group-b-rally/blob/main/package.json
- Renderer / loop / globals / error HTML: https://github.com/Zetnovs-0/group-b-rally/blob/main/js/main.js
- Stage lifecycle / 120 Hz physics / state / race timer: https://github.com/Zetnovs-0/group-b-rally/blob/main/js/game.js
- Конфигурация/record helpers: https://github.com/Zetnovs-0/group-b-rally/blob/main/js/config.js
- Local dev server: https://github.com/Zetnovs-0/group-b-rally/blob/main/run.sh
- Gitignore: https://github.com/Zetnovs-0/group-b-rally/blob/main/.gitignore
- Vendored Three.js (версия требует проверки): https://github.com/Zetnovs-0/group-b-rally/blob/main/vendor/three.module.js

### Что ещё необходимо для полноценного security-аудита

Нужно загрузить полный ZIP/clone и выполнить автоматические проверки всех source-файлов, установить версию vendored Three.js, изучить реальный production hosting, запустить игру во всех поддерживаемых браузерах и выполнить динамическое тестирование. До этого все пункты со статусом «вероятный дефект/гипотеза» **не следует считать воспроизведёнными багами**.
