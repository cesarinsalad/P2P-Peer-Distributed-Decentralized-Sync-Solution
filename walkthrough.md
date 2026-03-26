## Resumen de la Implementación
El producto mínimo viable (MVP) del P2P Sync Solution ha sido completamente implementado utilizando **Node.js y TypeScript**.

El proyecto cumple con todos los requisitos solicitados:
1. **Descubrimiento de nodos (mDNS):** Se implementó usando la librería `multicast-dns` ([src/discovery.ts](file:///home/cesarinsalad/developer/p2p-sync/src/discovery.ts)). Los nodos en la misma red local emiten su presencia y descubren a otros dinámicamente.
2. **Handshake y Túnel de Conexión:** Utilizando el módulo nativo `net` de Node.js, los nodos establecen exitosamente una conexión persistente **TCP** de dos vías cuando se detectan entre sí ([src/network.ts](file:///home/cesarinsalad/developer/p2p-sync/src/network.ts)).
3. **Transferencia de blobs (Chunks):** Se implementaron `ReadStream` y `WriteStream` para enviar archivos grandes en pequeños fragmentos (chunks de 64 KB), protegiendo la memoria ([src/transfer.ts](file:///home/cesarinsalad/developer/p2p-sync/src/transfer.ts)).
4. **Validación Checksum (SHA-256):** Cada archivo sincronizado tiene su integridad verificada recalculando y comparando su hash SHA-256 nativo mediante la librería `crypto` de Node ([src/checksum.ts](file:///home/cesarinsalad/developer/p2p-sync/src/checksum.ts)).

## Cómo probar el MVP en Local
Se ha desarrollado un orquestador ([src/index.ts](file:///home/cesarinsalad/developer/p2p-sync/src/index.ts)) que crea un directorio `sync-<PUERTO>` único por instancia y vigila los cambios de archivos para diseminarlos a la red.

Para ver la sincronización en acción en tu misma computadora, abre **dos ventanas de terminal** distintas en el directorio `/home/cesarinsalad/developer/p2p-sync/` y ejecuta los siguientes comandos:

**Terminal 1:**
```bash
PORT=3001 npx ts-node src/index.ts
```

**Terminal 2:**
```bash
PORT=3002 npx ts-node src/index.ts
```

### Resultados Esperados
- En los "logs" podrás ver cómo un nodo detecta al otro automáticamente usando mDNS.
- Cada instancia creará de forma automática archivos de prueba (ej. `hello-3001.txt` y `hello-3002.txt`).
- En cuanto se conectan, los directorios `sync-3001` y `sync-3002` intercambiarán su contenido mediante fragmentos.
- La consola confirmará que la validación Checksum SHA-256 es un "SUCCESS" para cada archivo intercambiado.
