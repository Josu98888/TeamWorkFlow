# auth — En migración a `core`

Esta carpeta conserva el código del servicio `auth` (identidad). Se está fusionando con `backend/gateway` en [`backend/core`](../core/README.md) como el módulo `auth` (tarea T6 de [`odd/tasks/two-service-architecture.md`](../../odd/tasks/two-service-architecture.md)) y luego se eliminará. Ver la [decisión de arquitectura](../../docs/architecture.md).

- Resumen y rutas: [`backend/core/README.md`](../core/README.md).
- Reglas y contrato del módulo: [`backend/core/src/auth/AGENTS.md`](../core/src/auth/AGENTS.md).
- Plan de pasos: [`backend/core/src/auth/STEPS.md`](../core/src/auth/STEPS.md).
- Modelo de datos: [`docs/database.md`](../../docs/database.md#auth).

Para trabajar con el código actual:

```bash
cd backend/auth
pnpm install
pnpm start:dev

# Calidad
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```
