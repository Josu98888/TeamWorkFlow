# gateway — En migración a `core`

Esta carpeta conserva el código del antiguo gateway HTTP. Se está fusionando con `backend/auth` en [`backend/core`](../core/README.md) (tarea T6 de [`odd/tasks/two-service-architecture.md`](../../odd/tasks/two-service-architecture.md)) y luego se eliminará. El backend del MVP son ahora dos servicios, `core` y [`telemetry`](../telemetry/README.md); ver la [decisión de arquitectura](../../docs/architecture.md).

- Documentación de la capa HTTP: [`backend/core/README.md`](../core/README.md) y [`backend/core/AGENTS.md`](../core/AGENTS.md).
- Torre de Control (WebSocket): [`backend/telemetry/README.md`](../telemetry/README.md).

Para trabajar con el código actual:

```bash
cd backend/gateway
pnpm install
pnpm start:dev

# Calidad
pnpm lint
pnpm test
pnpm build
```
