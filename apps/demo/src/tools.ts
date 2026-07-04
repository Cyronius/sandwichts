/**
 * The TaskBoard tool surface (SW-DEMO-E2E) — the ONE definition each tool
 * needs: JSON-schema parameters for the prompt + a handler mutating the live
 * store. `get_inspirational_quote` is a remoteTool (server round-trip).
 */
import { remoteTool, type ToolMap } from '@sandwichts/core';
import { boardStore } from './store';

const S = (description: string) => ({ type: 'string', description });

export const boardTools: ToolMap = {
    get_board: {
        definition: {
            name: 'get_board',
            description: 'Read the full board: columns, cards (id/title/description/color), and theme.',
            parameters: { type: 'object', properties: {}, required: [] },
        },
        handler: () => ({ ok: true, board: boardStore.getSnapshot() }),
    },
    add_card: {
        definition: {
            name: 'add_card',
            description: 'Add a card to a column.',
            parameters: {
                type: 'object',
                properties: {
                    columnId: S('Target column id (see get_board / boardContext)'),
                    title: S('Card title'),
                    description: S('Optional body text'),
                    color: S('Optional CSS accent color, e.g. "#f2b855" or "mistyrose"'),
                },
                required: ['columnId', 'title'],
            },
        },
        handler: (args: any) => {
            const card = boardStore.addCard(args.columnId, {
                title: args.title,
                description: args.description,
                color: args.color,
            });
            return card ? { ok: true, card } : { ok: false, error: `No column ${args.columnId}` };
        },
    },
    update_card: {
        definition: {
            name: 'update_card',
            description: 'Update a card\'s title, description, or color.',
            parameters: {
                type: 'object',
                properties: {
                    cardId: S('Card id'),
                    title: S('New title'),
                    description: S('New description'),
                    color: S('New CSS accent color'),
                },
                required: ['cardId'],
            },
        },
        handler: (args: any) => {
            const card = boardStore.updateCard(args.cardId, {
                ...(args.title !== undefined ? { title: args.title } : {}),
                ...(args.description !== undefined ? { description: args.description } : {}),
                ...(args.color !== undefined ? { color: args.color } : {}),
            });
            return card ? { ok: true, card } : { ok: false, error: `No card ${args.cardId}` };
        },
    },
    batch_update_cards: {
        definition: {
            name: 'batch_update_cards',
            description: 'Update several cards in one call — preferred over many update_card calls.',
            parameters: {
                type: 'object',
                properties: {
                    updates: {
                        type: 'array',
                        description: 'Array of { cardId, title?, description?, color? }',
                        items: { type: 'object' },
                    },
                },
                required: ['updates'],
            },
        },
        handler: (args: any) => {
            const results = (args.updates as any[]).map((u) => {
                const card = boardStore.updateCard(u.cardId, {
                    ...(u.title !== undefined ? { title: u.title } : {}),
                    ...(u.description !== undefined ? { description: u.description } : {}),
                    ...(u.color !== undefined ? { color: u.color } : {}),
                });
                return card ? { ok: true, card } : { ok: false, error: `No card ${u.cardId}` };
            });
            return { ok: results.every((r) => r.ok), results };
        },
    },
    move_card: {
        definition: {
            name: 'move_card',
            description: 'Move a card to another column.',
            parameters: {
                type: 'object',
                properties: {
                    cardId: S('Card id'),
                    toColumnId: S('Destination column id'),
                    position: { type: 'number', description: 'Optional index in the destination column' },
                },
                required: ['cardId', 'toColumnId'],
            },
        },
        handler: (args: any) => (
            boardStore.moveCard(args.cardId, args.toColumnId, args.position)
                ? { ok: true }
                : { ok: false, error: `Cannot move ${args.cardId} to ${args.toColumnId}` }
        ),
    },
    delete_card: {
        definition: {
            name: 'delete_card',
            description: 'Delete a card.',
            parameters: {
                type: 'object',
                properties: { cardId: S('Card id') },
                required: ['cardId'],
            },
        },
        handler: (args: any) => (
            boardStore.deleteCard(args.cardId) ? { ok: true } : { ok: false, error: `No card ${args.cardId}` }
        ),
    },
    add_column: {
        definition: {
            name: 'add_column',
            description: 'Add a new column to the board.',
            parameters: {
                type: 'object',
                properties: { title: S('Column title') },
                required: ['title'],
            },
        },
        handler: (args: any) => ({ ok: true, column: boardStore.addColumn(args.title) }),
    },
    set_board_theme: {
        definition: {
            name: 'set_board_theme',
            description: 'Set the board-wide theme: accent color and/or display title.',
            parameters: {
                type: 'object',
                properties: {
                    accent: S('CSS accent color for the board chrome'),
                    title: S('Board display title'),
                },
                required: [],
            },
        },
        handler: (args: any) => ({
            ok: true,
            theme: boardStore.setTheme({
                ...(args.accent !== undefined ? { accent: args.accent } : {}),
                ...(args.title !== undefined ? { title: args.title } : {}),
            }),
        }),
    },
    get_inspirational_quote: remoteTool({
        name: 'get_inspirational_quote',
        description: 'Fetch an inspirational quote (server round-trip).',
        parameters: { type: 'object', properties: {}, required: [] },
    }),
};

/** The read-only boardContext bound in script scope (mirrors the prompt payload). */
export function buildBoardContext() {
    const { columns, theme } = boardStore.getSnapshot();
    return {
        theme,
        columns: columns.map((c) => ({
            id: c.id,
            title: c.title,
            cards: c.cards.map((card) => ({ id: card.id, title: card.title, color: card.color ?? null })),
        })),
    };
}
