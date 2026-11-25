# ADR-001: Elegir la ruta de inferencia por tarea, entre el cliente y la nube

| | |
|---|---|
| **Estado** | Aceptada |
| **Fecha** | 23 de noviembre de 2026 |
| **Alcance** | Dónde se ejecuta cada tarea de IA de alRato |
| **Código** | [`src/ai/router.ts`](../../src/ai/router.ts), [`src/ai/engine.ts`](../../src/ai/engine.ts) |
| **Ver también** | [Arquitectura (en inglés)](../ARCHITECTURE.md) · [English version](../ADR-001-hybrid-inference.md) |

> Un *Architecture Decision Record* (ADR) es un documento breve que deja por escrito una decisión de arquitectura: qué problema había, qué se decidió, qué otras opciones se descartaron y qué consecuencias se aceptaron.

## Contexto

alRato le permite a un estudiante fotografiar la pizarra en clase y ocuparse de ella después. La aplicación lee la foto, la organiza, ayuda con una escalera de pistas, conecta el apunte con otro anterior y programa la práctica. Cada uno de estos pasos llama a un modelo de lenguaje, y cada uno tiene necesidades distintas.

Las fuerzas que definieron esta decisión fueron:

1. **La captura ocurre en el celular, y los navegadores móviles no tienen modelo local.** La inferencia en el dispositivo con Firebase AI Logic en la web requiere Chrome de escritorio. [Chrome para Android y iOS no está soportado](https://developer.chrome.com/docs/ai/get-started). La ruta en la nube no puede ser un detalle secundario.
2. **Las computadoras con buen hardware pueden ejecutar Gemini Nano gratis.** Chrome necesita 22 GB libres en el volumen del perfil y, además, una GPU con más de 4 GB de VRAM o bien 16 GB de RAM con al menos 4 núcleos de CPU.
3. **La entrada es difícil.** Una pizarra tiene letra a mano, notación matemática y mala iluminación, en inglés o en español.
4. **Los estudiantes pagan sus datos móviles.** La foto es lo más pesado que envía la aplicación, y la conexión en un salón de clases no siempre es confiable.
5. **Algunos apuntes son personales.** El estudiante debe poder decir "esto se queda en mi dispositivo" y que eso se cumpla.
6. **La cuota es limitada.** Los modelos en la nube por defecto figuran como ["billing not required"](https://firebase.google.com/docs/ai-logic/models) en la Gemini Developer API, que tiene límites de uso. El 24 de noviembre de 2026, Google AI Studio mostró 500 solicitudes diarias para cada uno de `gemini-3.5-flash-lite` y `gemini-3.1-flash-lite`, y 20 para `gemini-3.8-flash`, por proyecto y compartidas por todos los usuarios.
7. **La atención es el recurso más escaso.** Capturar debe tomar segundos, porque el estudiante necesita volver a mirar la pizarra.

## Decisión

**Elegimos la ruta de inferencia por tarea, usando los cuatro modos de inferencia del SDK de Firebase AI Logic, a través de una sola función de política: `decideRoute()`.** No fijamos un único modo para toda la aplicación.

| Trabajo | Dónde se ejecuta | Por qué |
|---|---|---|
| Captura, normalización de la imagen, almacenamiento | Cliente, siempre | Debe ser inmediato y funcionar sin conexión. Las fotos son el dato más sensible |
| Cola, enrutamiento, reintentos | Cliente, siempre | Debe funcionar sin red |
| Recuperación (lo que necesita contra lo que enseña) | Cliente, siempre | Lee toda la biblioteca, así que nunca debería salir del dispositivo |
| Programación de repasos, validación, presentación | Cliente, siempre | No necesita modelo |
| **Leer una foto** | `PREFER_IN_CLOUD`, o `PREFER_ON_DEVICE` con datos móviles | Es la tarea más difícil y nadie la está esperando |
| **Organizar un apunte** | `PREFER_ON_DEVICE` | Corta, estructurada y se hace con cada apunte |
| **Pistas** | `PREFER_ON_DEVICE` | Interactivas y frecuentes |
| **Entradas largas** | `PREFER_IN_CLOUD` | Más de 3500 caracteres por defecto |
| **Apuntes privados, cualquier tarea** | `ONLY_ON_DEVICE`, o esperar | Es una instrucción explícita del estudiante |
| **Sin ruta disponible** | Esperar en la cola | Se retoma cuando se abre una ruta |
| Verificación de la app, servicio de modelos, ajustes remotos | Nube | App Check, AI Logic, Remote Config |
| Mover apuntes entre los dispositivos del estudiante | Firestore, solo si el estudiante lo activa | Permite estudiar en una laptop con Gemini Nano una foto tomada en el celular. Los apuntes privados nunca se sincronizan |

Tres decisiones de apoyo hacen que esto sea seguro:

- **Una barrera de privacidad antes del SDK.** En el SDK 13.4, `ONLY_ON_DEVICE` en un navegador sin Prompt API se va a la nube sin avisar: `chromeAdapterFactory` no crea el adaptador cuando falta `LanguageModel`, y `callCloudOrDevice` envía a la nube cualquier petición sin adaptador. La [documentación](https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options) dice que este modo lanza una excepción. `assertOnDevicePossible()` rechaza la llamada antes de que corra el SDK, y `tests/engine.test.ts` fija este comportamiento para que nos enteremos si cambia.
- **Un respaldo propio cuando falla el dispositivo.** El SDK recurre a la nube cuando el modelo no está disponible, pero no cuando la llamada local falla o devuelve algo inutilizable. El motor reintenta esos casos en la nube, salvo en los apuntes privados.
- **Comprobantes que vienen del SDK.** Cada respuesta registra `response.inferenceSource`, de modo que la interfaz muestra lo que realmente ocurrió y no lo que la política pretendía.

## Cómo ponderamos latencia, costo y privacidad

| Tarea | ¿Alguien espera? | Carga | Exigencia de calidad | Frecuencia | Por defecto |
|---|---|---|---|---|---|
| Leer | No, corre después de clase | Grande (foto) | La más alta | Una vez por apunte | Primero la nube |
| Organizar | Rara vez | Pequeña | Moderada | Una vez por apunte | Primero el dispositivo |
| Pista | Sí | Pequeña | Moderada | Varias por apunte | Primero el dispositivo |

### Latencia

La cola cambia lo que significa la latencia en este caso. **Leer no es interactivo.** El estudiante ya volvió a mirar la pizarra, así que un viaje de ida y vuelta por la red no le cuesta nada y se puede aceptar una ruta más lenta.

**Las pistas sí son interactivas.** El estudiante está frente a un problema, esperando. Ejecutarlas en el dispositivo evita la red por completo, algo que ayuda en el bus o con el wifi débil del campus. La captura está desacoplada de ambas, así que nunca espera a un modelo.

Todavía no hemos medido la latencia en el dispositivo ni en la nube, así que este razonamiento es de arquitectura y no incluye cifras. <!-- MEASURE: latencia mediana y p95 por tarea y por ruta, en hardware que cumpla los requisitos de Chrome -->

### Costo

Hay dos presupuestos, y el del estudiante es el que más importa.

- **Los datos móviles del estudiante.** Las fotos son la carga más pesada. Con una conexión medida y un modelo local disponible, el enrutador lee la foto en el dispositivo (`save_data`).
- **La cuota de la API.** Organizar y dar pistas son las llamadas más frecuentes. Ejecutarlas en el dispositivo no consume cuota y la reserva para la tarea que más gana con la nube. Un tope diario por navegador (`daily_cloud_cap`, 40 por defecto) y una revisión de cuota por modelo (un modelo que agotó su cupo diario se omite hasta la medianoche del Pacífico) evitan que un bucle o un error agote la capa gratuita compartida.
- **El costo para el dispositivo.** El modelo local es una descarga única que requiere una conexión sin límite y bastante disco libre. Nunca la iniciamos sin un clic del estudiante.

<!-- MEASURE: bytes típicos por apunte en la ruta de nube, tomados de comprobantes reales -->

### Privacidad

- La recuperación lee toda la biblioteca del estudiante, así que siempre corre en el dispositivo.
- Un apunte marcado como privado nunca recibe un modo que pueda llegar a la nube. Si el dispositivo no puede ejecutarlo, espera. Preferimos un apunte que espera a un apunte que se filtra.
- De los demás apuntes solo se envía lo que la tarea necesita. Una pista incluye como máximo tres fragmentos relacionados, no privados, de 260 caracteres.
- Cualquier estudiante puede ver en el comprobante qué salió de su dispositivo.

### Calidad

Leer matemáticas y letra a mano es la tarea donde más pesa la calidad del modelo, y un error ahí contamina todo lo que viene después. No damos por hecho que Gemini Nano iguale a la nube en esto, así que la lectura prefiere la nube siempre que el estudiante no esté pagando por los datos. El estudiante puede corregir cualquier transcripción, y al editarla el proceso vuelve a empezar.

<!-- MEASURE: exactitud de transcripción en fotos reales de pizarras, nube contra Nano -->

## Alternativas consideradas

### A. Solo nube

Es la opción más simple y funcionaría en cualquier celular. La descartamos porque no puede cumplir con un apunte privado, deja de funcionar sin conexión, gasta cuota en tareas pequeñas y envía cada apunte a un servidor aunque la tarea no lo necesite.

### B. Solo en el dispositivo

Es la mejor opción en privacidad y costo. La descartamos porque el dispositivo donde ocurre la captura, el celular, no tiene Prompt API en el navegador. Además dejaría fuera a quienes tienen computadoras por debajo de los requisitos de Chrome, y dependería del modelo local para la tarea más difícil.

### C. Android nativo con ML Kit

Fue la alternativa más seria, porque habría puesto un modelo local en el celular. La exploramos y la descartamos por cuatro razones:

1. **El reconocimiento de texto de ML Kit no está hecho para notación matemática.** [Text Recognition v2](https://developers.google.com/ml-kit/vision/text-recognition/v2) cubre los alfabetos latino, chino, devanagari, japonés y coreano. Su documentación no describe soporte para fórmulas ni ecuaciones, que son el centro de nuestra entrada.
2. **La cobertura de idiomas no se ajusta a nuestros estudiantes.** La [guía de la Prompt API, en su versión archivada de abril de 2026](https://web.archive.org/web/20260417224627/https://developers.google.com/ml-kit/genai/prompt/android/get-started), solo listaba inglés y coreano como idiomas validados. La [guía actual](https://developers.google.com/ml-kit/genai/prompt/android/get-started) ya no publica una lista, y la [página general](https://developers.google.com/ml-kit/genai) indica que la disponibilidad varía según la configuración del dispositivo y los modelos descargados. No podíamos contar con el español.
3. **Las peticiones son pequeñas.** La entrada debe quedar [por debajo de 4000 tokens](https://developers.google.com/ml-kit/genai/prompt/android/get-started), algo justo para un apunte, los candidatos de apuntes anteriores y las instrucciones juntos.
4. **El celular del estudiante objetivo no está soportado.** La función solo corre en una [lista publicada de dispositivos](https://developers.google.com/ml-kit/genai), y el teléfono del estudiante para el que diseñamos no aparece en ella.

Una aplicación web, además, nos da un solo código para celulares y computadoras y no necesita tienda de aplicaciones. Si los modelos locales llegan a los navegadores móviles, el enrutador podrá usarlos sin cambiar la política.

### D. Un solo modo del SDK para toda la aplicación

`PREFER_ON_DEVICE` en todas partes es una línea de código, pero leería letra a mano con el modelo local siempre que existiera, incluso con wifi gratis. `PREFER_IN_CLOUD` en todas partes gastaría cuota y agregaría un viaje por la red a cada pista. Ninguno de los dos puede expresar "este apunte nunca debe salir". El valor del SDK híbrido está en elegir por tarea.

### E. Un backend o proxy propio

Un servidor permitiría limitar el uso desde el servidor y ocultar los prompts. También agregaría un lugar nuevo por donde pasan los apuntes de los estudiantes, además de código y costos que mantener. Firebase AI Logic con App Check permite que el cliente llame al modelo de forma segura sin un servidor nuestro, y eso encaja con una aplicación cuya premisa es que los datos se quedan con el estudiante.

### F. *Embeddings* para la recuperación

Los *embeddings* son la forma habitual de encontrar apuntes relacionados. Requerirían enviar al navegador un modelo de *embeddings* aparte, o bien mandar los apuntes del estudiante a la nube. Además tienden a encontrar apuntes *parecidos*, cuando lo que buscamos son *prerrequisitos*. Comparar lo que un apunte `needs` (necesita) con lo que otro `teaches` (enseña) corre en cualquier navegador, funciona entre idiomas gracias a claves canónicas en inglés y es fácil de explicar.

## Consecuencias

**Positivas**

- La aplicación funciona en cualquier navegador moderno y mejora en hardware capaz.
- Los apuntes privados tienen una garantía real, respaldada por una prueba contra el SDK real.
- La cuota y los datos móviles se usan donde más aportan.
- Cada ruta es visible para el estudiante, y la política vive en una sola función pura y probada.

**Negativas, y aceptadas**

- **Dos modelos que sostener.** La calidad de las respuestas puede variar entre rutas. Los esquemas compartidos, los validadores y el reintento en la nube lo reducen, pero no lo eliminan.
- **Los apuntes privados esperan en el celular.** Sin modelo local, un apunte privado se queda como una foto sin ayuda de la IA y, como los apuntes privados nunca se sincronizan, una laptop no puede procesarlo por el celular. Aquí elegimos la privacidad por encima de la función.
- **La privacidad empieza en la captura.** Marcar un apunte como privado más tarde no recupera lo que ya se envió, y un proceso que ya esté en marcha sobre ese apunte puede terminar su secuencia actual en la nube.
- **Dependencia del comportamiento del SDK.** Nos apoyamos en detalles internos que pueden cambiar. La prueba que fija ese comportamiento es nuestra alarma.
- **Más difícil de verificar.** Gemini Nano real necesita hardware específico. Nuestras pruebas automáticas ejecutan el SDK real contra una Prompt API simulada, lo que comprueba la integración, pero no la calidad ni la velocidad del modelo.

## Validación pendiente

Revisaremos esta decisión cuando tengamos estas mediciones. Hasta entonces, ningún documento de este proyecto las reporta.

- Latencia por tarea y por ruta en hardware real <!-- MEASURE: latencia en dispositivo y en nube -->
- Exactitud de transcripción en fotos reales de pizarras, nube contra Nano <!-- MEASURE: exactitud de transcripción -->
- Precisión de "Conectado con tu apunte" en apuntes reales de estudiantes <!-- MEASURE: precisión de las conexiones -->
- Bytes enviados por apunte en uso normal <!-- MEASURE: bytes por apunte -->

## Referencias

- Firebase: [inferencia híbrida en la web](https://firebase.google.com/docs/ai-logic/hybrid/web/get-started), [opciones de configuración](https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options), [App Check para AI Logic](https://firebase.google.com/docs/ai-logic/app-check), [modelos compatibles](https://firebase.google.com/docs/ai-logic/models)
- Chrome: [primeros pasos con la IA integrada](https://developer.chrome.com/docs/ai/get-started), [Prompt API](https://developer.chrome.com/docs/ai/prompt-api)
- ML Kit: [Text Recognition v2](https://developers.google.com/ml-kit/vision/text-recognition/v2), [panorama de las APIs GenAI](https://developers.google.com/ml-kit/genai), [Prompt API en Android](https://developers.google.com/ml-kit/genai/prompt/android/get-started)
- Ciencia del aprendizaje detrás del producto: ver las [referencias del README](../../README.md#references)
