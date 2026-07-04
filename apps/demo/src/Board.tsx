import { useSyncExternalStore } from 'react';
import { boardStore } from './store';

export function Board() {
    const board = useSyncExternalStore(boardStore.subscribe, boardStore.getSnapshot);
    return (
        <div className="board" style={{ ['--accent' as string]: board.theme.accent }}>
            <h2 className="board-title">{board.theme.title}</h2>
            <div className="columns">
                {board.columns.map((column) => (
                    <section className="column" key={column.id} data-testid={`col-${column.id}`}>
                        <h3>{column.title} <span className="count">{column.cards.length}</span></h3>
                        {column.cards.map((card) => (
                            <article
                                className="card"
                                key={card.id}
                                style={card.color ? { borderLeftColor: card.color } : undefined}
                            >
                                <div className="card-title">{card.title}</div>
                                {card.description && <div className="card-desc">{card.description}</div>}
                            </article>
                        ))}
                    </section>
                ))}
            </div>
        </div>
    );
}
