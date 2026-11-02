# KleeneLab

Aplicación web local para trabajar las dos direcciones del teorema de Kleene:

1. **Parte I:** convierte una expresión regular en un AFN-λ mediante la construcción recursiva usada en el material de clase.
2. **Parte II:** convierte un AFN en una expresión regular planteando ecuaciones de lenguajes y eliminando incógnitas con el lema de Arden.

## Funciones principales

- Editor gráfico de autómatas con estados arrastrables.
- Creación de transiciones, lazos, estado inicial y estados de aceptación.
- Soporte para unión (`∪`, `|` o `+`), concatenación implícita o `·`, estrella `*`, lambda (`λ` o `ε`) y lenguaje vacío (`∅`).
- Eliminación automática de transiciones lambda antes de aplicar la Parte II.
- Simulación de cadenas con visualización de los estados activos.
- Desarrollo paso a paso de ambas construcciones.
- Exportación del diagrama a SVG y guardado/carga del proyecto en JSON.
- Deshacer, rehacer y organización automática del lienzo.

## Ejecución

La aplicación no requiere instalar dependencias. Iníciala con Node.js:

```powershell
node server.mjs
```

Luego abre `http://localhost:4173`.

## Pruebas

```powershell
node --test tests\*.test.mjs
```

Las pruebas cubren el analizador de expresiones, la construcción recursiva usada en clase, los casos λ/∅, el método de Arden y una comprobación de equivalencia por cadenas de muestra.

## Estructura

- `index.html`: interfaz y componentes.
- `styles.css`: diseño adaptable.
- `app.js`: interacción del editor y presentación de resultados.
- `core.mjs`: algoritmos de expresiones regulares y autómatas.
- `tests/core.test.mjs`: pruebas automáticas del núcleo.
