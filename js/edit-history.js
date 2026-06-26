/** 编辑历史：撤销 / 重做栈 */

export function createEditHistory(limit = 80) {
  let undoStack = [];
  let redoStack = [];

  return {
    push(snapshot) {
      undoStack.push(snapshot);
      if (undoStack.length > limit) undoStack.shift();
      redoStack = [];
    },
    undo(current) {
      if (!undoStack.length) return null;
      redoStack.push(current);
      return undoStack.pop();
    },
    redo(current) {
      if (!redoStack.length) return null;
      undoStack.push(current);
      return redoStack.pop();
    },
    canUndo() {
      return undoStack.length > 0;
    },
    canRedo() {
      return redoStack.length > 0;
    },
    clear() {
      undoStack = [];
      redoStack = [];
    },
  };
}
