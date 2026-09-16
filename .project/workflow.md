LOOP:
Lee el estado actual del proyecto.
Selecciona la siguiente tarea elegible.
Delega la implementación al agente developer.
Delega, en paralelo, al agente tester y al
agente reviewer.
SI falla (tester o reviewer):
    identifica la causa
    corrige
    vuelve a verificar
SI pasa:
    delega al agente documenter
    actualiza tasks.md
    registra la tarea como completed
    haz commit de la tarea
SI existen tareas pendientes:
    comienza nuevamente
SI no existen:
STOP