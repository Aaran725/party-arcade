export interface Cell {
  n: boolean;
  s: boolean;
  e: boolean;
  w: boolean;
}

export interface Maze {
  cols: number;
  rows: number;
  cells: Cell[];
}

function idx(cols: number, x: number, y: number): number {
  return y * cols + x;
}

/** Recursive-backtracker maze generator. */
export function generateMaze(cols: number, rows: number): Maze {
  const cells: Cell[] = Array.from({ length: cols * rows }, () => ({ n: true, s: true, e: true, w: true }));
  const visited = new Array(cols * rows).fill(false);

  const stack: [number, number][] = [[0, 0]];
  visited[idx(cols, 0, 0)] = true;

  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const neighbors: { x: number; y: number; dir: keyof Cell; opp: keyof Cell }[] = [];
    if (y > 0 && !visited[idx(cols, x, y - 1)]) neighbors.push({ x, y: y - 1, dir: "n", opp: "s" });
    if (y < rows - 1 && !visited[idx(cols, x, y + 1)]) neighbors.push({ x, y: y + 1, dir: "s", opp: "n" });
    if (x > 0 && !visited[idx(cols, x - 1, y)]) neighbors.push({ x: x - 1, y, dir: "w", opp: "e" });
    if (x < cols - 1 && !visited[idx(cols, x + 1, y)]) neighbors.push({ x: x + 1, y, dir: "e", opp: "w" });

    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }
    const next = neighbors[Math.floor(Math.random() * neighbors.length)];
    cells[idx(cols, x, y)][next.dir] = false;
    cells[idx(cols, next.x, next.y)][next.opp] = false;
    visited[idx(cols, next.x, next.y)] = true;
    stack.push([next.x, next.y]);
  }

  return { cols, rows, cells };
}

export function cellAt(maze: Maze, x: number, y: number): Cell | undefined {
  if (x < 0 || y < 0 || x >= maze.cols || y >= maze.rows) return undefined;
  return maze.cells[idx(maze.cols, x, y)];
}
