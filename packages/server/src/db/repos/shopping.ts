import { type Db, newId } from "../index.ts";

/** A check of a computed line, or a line of the user's own (#49). */
export interface ShoppingItem {
  id: string;
  kind: "check" | "line";
  /** A check: the computed line's key. */
  lineKey: string | null;
  /** A check: the grams to buy when it was checked. */
  grams: number | null;
  /** A line: what to buy. */
  text: string | null;
  /** A line: checked; a check row is checked by existing. */
  checked: boolean;
  rangeFrom: string;
  rangeTo: string;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: string;
  kind: "check" | "line";
  line_key: string | null;
  grams: number | null;
  text: string | null;
  checked: number;
  range_from: string;
  range_to: string;
  created_at: number;
  updated_at: number;
}

const toItem = (r: Row): ShoppingItem => ({
  id: r.id,
  kind: r.kind,
  lineKey: r.line_key,
  grams: r.grams,
  text: r.text,
  checked: r.checked === 1,
  rangeFrom: r.range_from,
  rangeTo: r.range_to,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * What the user did to the shopping list: checks and their own lines, each for the range it was
 * made in. A row applies to every range that overlaps its own.
 */
export class ShoppingItemRepo {
  constructor(private readonly db: Db) {}

  /** The rows whose range overlaps `from`–`to`, oldest first. */
  overlapping(from: string, to: string): ShoppingItem[] {
    return this.db
      .query<Row, [string, string]>(
        "SELECT * FROM shopping_items WHERE range_from <= ? AND range_to >= ? ORDER BY created_at, id",
      )
      .all(to, from)
      .map(toItem);
  }

  get(id: string): ShoppingItem | null {
    const r = this.db.query<Row, [string]>("SELECT * FROM shopping_items WHERE id = ?").get(id);
    return r ? toItem(r) : null;
  }

  /** A computed line checked with the grams it had, for the range. */
  check(key: string, grams: number | null, from: string, to: string, now = Date.now()): void {
    this.db
      .query(
        `INSERT INTO shopping_items (id, kind, line_key, grams, checked, range_from, range_to, created_at, updated_at)
         VALUES (?, 'check', ?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(newId(), key, grams, from, to, now, now);
  }

  /** A computed line unchecked: every check of it that applies to the range goes. */
  uncheck(key: string, from: string, to: string): void {
    this.db
      .query(
        "DELETE FROM shopping_items WHERE kind = 'check' AND line_key = ? AND range_from <= ? AND range_to >= ?",
      )
      .run(key, to, from);
  }

  addLine(l: { id?: string; text: string; from: string; to: string; now?: number }): ShoppingItem {
    const id = l.id ?? newId();
    const now = l.now ?? Date.now();
    this.db
      .query(
        `INSERT INTO shopping_items (id, kind, text, checked, range_from, range_to, created_at, updated_at)
         VALUES (?, 'line', ?, 0, ?, ?, ?, ?)`,
      )
      .run(id, l.text, l.from, l.to, now, now);
    return this.get(id)!;
  }

  setLineChecked(id: string, checked: boolean, now = Date.now()): void {
    this.db
      .query("UPDATE shopping_items SET checked = ?, updated_at = ? WHERE id = ? AND kind = 'line'")
      .run(checked ? 1 : 0, now, id);
  }

  delete(id: string): boolean {
    return this.db.query("DELETE FROM shopping_items WHERE id = ?").run(id).changes > 0;
  }
}
