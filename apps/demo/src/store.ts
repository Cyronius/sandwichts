/**
 * TaskBoard state — a tiny external store (subscribe + snapshot) so tool
 * handlers mutate live state synchronously outside React, and components
 * follow via useSyncExternalStore.
 */

export interface BoardCard {
    id: string;
    title: string;
    description?: string;
    /** CSS color for the card accent. */
    color?: string;
}

export interface BoardColumn {
    id: string;
    title: string;
    cards: BoardCard[];
}

export interface BoardTheme {
    /** Accent CSS color for the board chrome. */
    accent: string;
    /** Board display title. */
    title: string;
}

export interface BoardState {
    columns: BoardColumn[];
    theme: BoardTheme;
}

let state: BoardState = {
    theme: { accent: '#6b8afd', title: 'Launch prep' },
    columns: [
        { id: 'todo', title: 'To Do', cards: [{ id: 'c1', title: 'Write announcement post' }] },
        { id: 'doing', title: 'Doing', cards: [{ id: 'c2', title: 'Fix signup flow', color: '#f2b855' }] },
        { id: 'done', title: 'Done', cards: [{ id: 'c3', title: 'Pick launch date', color: '#7fd1ae' }] },
    ],
};

let nextId = 4;
const listeners = new Set<() => void>();

function commit(next: BoardState) {
    state = next;
    listeners.forEach((l) => l());
}

export const boardStore = {
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    getSnapshot(): BoardState {
        return state;
    },

    findCard(cardId: string): { column: BoardColumn; card: BoardCard } | null {
        for (const column of state.columns) {
            const card = column.cards.find((c) => c.id === cardId);
            if (card) return { column, card };
        }
        return null;
    },

    addColumn(title: string): BoardColumn {
        const column: BoardColumn = { id: `col${nextId++}`, title, cards: [] };
        commit({ ...state, columns: [...state.columns, column] });
        return column;
    },

    addCard(columnId: string, card: Omit<BoardCard, 'id'>): BoardCard | null {
        const column = state.columns.find((c) => c.id === columnId);
        if (!column) return null;
        const created: BoardCard = { id: `c${nextId++}`, ...card };
        commit({
            ...state,
            columns: state.columns.map((c) => (c.id === columnId ? { ...c, cards: [...c.cards, created] } : c)),
        });
        return created;
    },

    updateCard(cardId: string, patch: Partial<Omit<BoardCard, 'id'>>): BoardCard | null {
        let updated: BoardCard | null = null;
        commit({
            ...state,
            columns: state.columns.map((column) => ({
                ...column,
                cards: column.cards.map((card) => {
                    if (card.id !== cardId) return card;
                    updated = { ...card, ...patch };
                    return updated;
                }),
            })),
        });
        return updated;
    },

    moveCard(cardId: string, toColumnId: string, position?: number): boolean {
        const found = boardStore.findCard(cardId);
        const target = state.columns.find((c) => c.id === toColumnId);
        if (!found || !target) return false;
        const without = state.columns.map((column) => ({
            ...column,
            cards: column.cards.filter((c) => c.id !== cardId),
        }));
        commit({
            ...state,
            columns: without.map((column) => {
                if (column.id !== toColumnId) return column;
                const cards = [...column.cards];
                cards.splice(position ?? cards.length, 0, found.card);
                return { ...column, cards };
            }),
        });
        return true;
    },

    deleteCard(cardId: string): boolean {
        if (!boardStore.findCard(cardId)) return false;
        commit({
            ...state,
            columns: state.columns.map((column) => ({
                ...column,
                cards: column.cards.filter((c) => c.id !== cardId),
            })),
        });
        return true;
    },

    setTheme(patch: Partial<BoardTheme>): BoardTheme {
        commit({ ...state, theme: { ...state.theme, ...patch } });
        return state.theme;
    },
};
