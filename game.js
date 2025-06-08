// game.js

import { Chess } from './lib/chess.js';

// --- Global Variables ---
let board = null; // chessboard.js instance
let game = new Chess(); // chess.js instance
let engine = null; // Stockfish worker
let currentFen = '';
let selectedPieceSquare = null;
let pieceHueStyleElement = null; // For dynamic CSS for piece hue

// Predefined FENs - Updated with more Chess960 examples
const PREDEFINED_FENS = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', // Standard Chess
    'rnbqkbAr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBAR w HEhe - 0 1', // Chess960 Example (SPID 960) Castling: White E-H, Black e-h
    'bbrqnknr/pppppppp/8/8/8/8/PPPPPPPP/BBRQNKNR w CGcg - 0 1', // Chess960 Example (SPID 518) Castling: White C-G, Black c-g
    'qnrbkbAr/pppppppp/8/8/8/8/PPPPPPPP/QNRBKBRA w CFcf - 0 1', // Chess960 Example (SPID 622) Castling: White C-F, Black c-f
    'rkbqnbnr/pppppppp/8/8/8/8/PPPPPPPP/RKBQNBNR w GCgc - 0 1', // Chess960 Example (SPID 430) Castling: White C-G, Black c-g
    'qnrbbknr/pppppppp/8/8/8/8/PPPPPPPP/QNRBBKNR w CFcf - 0 1'  // Chess960 Example (SPID 22)  Castling: White C-F, Black c-f
];


let activeHighlightRequests = 0;
let moveEvalCache = {};
let currentHighlightSquaresInfo = [];

// --- Utility Functions ---
function statusMessage(message) {
    $('#status').html(message);
    console.log("Status:", message);
}

function engineStatusMessage(message) {
    $('#engineStatus').text(`Engine Status: ${message}`);
    console.log("Engine Status:", message);
}

function updateBoardPosition(fenToSet, isPlayerMove = false) {
    currentFen = game.fen(); // Always get the FEN from the definitive game state

    if (board) {
        board.position(currentFen, !isPlayerMove); // Animate if it's not an immediate player action
    }
    $('#fenInput').val(currentFen);

    let statusStr = "";
    const turn = game.turn() === 'w' ? "White" : "Black";

    if (game.isCheckmate()) {
        statusStr = `Checkmate! ${turn === 'White' ? 'Black' : 'White'} wins.`;
    } else if (game.isDraw()) {
        statusStr = "Draw!";
        if (game.isStalemate()) statusStr += " (Stalemate)";
        else if (game.isThreefoldRepetition()) statusStr += " (Threefold Repetition)";
        else if (game.isInsufficientMaterial()) statusStr += " (Insufficient Material)";
        else if (game.isDrawByFiftyMoves()) statusStr += " (50-move rule)";
    } else {
        statusStr = `${turn} to move.`;
        if (game.inCheck()) {
            statusStr = `${turn} is in check. ${statusStr}`;
        }
    }
    statusMessage(statusStr);
}


function startNewGame(fenToLoad) {
    let gameFen = fenToLoad;
    if (!gameFen || fenToLoad.trim() === "") {
        gameFen = PREDEFINED_FENS[Math.floor(Math.random() * PREDEFINED_FENS.length)];
    }

    try {
        game = new Chess(gameFen); // This sets up the game state
    } catch(e) {
        statusMessage(`<b>Error:</b> Invalid FEN for new game: "${gameFen}".<br/>Falling back to standard. Details: ${e.message}`);
        console.error(`Invalid FEN for new game: "${gameFen}". Error: ${e.message}`);
        game = new Chess(); // Fallback to standard game if FEN is bad
    }

    updateBoardPosition(game.fen()); // Update board and currentFen based on the new game instance

    if (engine) {
        sendToStockfish("ucinewgame");
        // Short delay to ensure 'ucinewgame' is processed before 'position'
        setTimeout(() => {
            sendToStockfish(`position fen ${game.fen()}`);
            // If it's AI's turn (e.g. player loaded FEN where AI moves)
            if (game.turn() !== 'w') { // Assuming player is White
                 statusMessage("Thinking...");
                 sendToStockfish("go depth 10");
            }
        }, 200); // Increased delay slightly
    }
}

// --- Highlighting and Visualization ---
function clearHighlights() {
    $('.square-55d63').css('background', ''); // Clear chessboard.js default selection highlight

    currentHighlightSquaresInfo.forEach(info => {
        $(`#board .square-${info.square}`).css('background-color', '').removeClass('highlighted-move-good highlighted-move-bad highlighted-move-neutral highlighted-move-best');
    });
    currentHighlightSquaresInfo = [];

    if (pieceHueStyleElement) {
        pieceHueStyleElement.textContent = '';
    }
    // Reset any piece-specific styling if needed, e.g., transform
    if (selectedPieceSquare) {
        $(`#board .square-${selectedPieceSquare} img`).css('transform', '');
    }

    activeHighlightRequests = 0;
    // moveEvalCache might be left alone or selectively cleared if needed,
    // but generally, it's for the current set of evaluations.
}

function getScoreColor(score, isBestMove = false) {
    let hue;
    const saturation = isBestMove ? '100%' : '80%'; // Best move more saturated
    const lightness = isBestMove ? '60%' : '50%';
    const alpha = isBestMove ? '0.65' : '0.45'; // Semi-transparent

    const normalizedScore = Math.max(-600, Math.min(600, score)); // Cap score for color range

    if (normalizedScore >= 0) { // Good for current player
        hue = 120 - (normalizedScore / 600) * 60; // Green (120) towards Yellow-Green (90)
    } else { // Bad for current player
        hue = 0 + (Math.abs(normalizedScore) / 600) * 60; // Red (0) towards Orange (30)
    }
    hue = Math.max(0, Math.min(120, hue));

    return `hsla(${hue}, ${saturation}, ${lightness}, ${alpha})`;
}

function applyHighlights() {
    if (activeHighlightRequests > 0 || currentHighlightSquaresInfo.length === 0) {
        return;
    }

    let bestScore = -Infinity;
    let bestItem = null;

    currentHighlightSquaresInfo.forEach(item => {
        if (item.score > bestScore) {
            bestScore = item.score;
            bestItem = item;
        }
    });

    currentHighlightSquaresInfo.forEach(item => {
        const isBest = bestItem && item.moveSAN === bestItem.moveSAN;
        const color = getScoreColor(item.score, isBest);
        const squareEl = $(`#board .square-${item.square}`);
        squareEl.css('background-color', color);
        squareEl.addClass(isBest ? 'highlighted-move-best' : (item.score > 50 ? 'highlighted-move-good' : (item.score < -50 ? 'highlighted-move-bad' : 'highlighted-move-neutral')));
    });

    if (bestItem && selectedPieceSquare) {
        const bestMoveColorForHue = getScoreColor(bestItem.score, true).replace(/hsla\((.*),.*\)/, 'hsl($1, 100%, 60%)');
        if (pieceHueStyleElement) {
            pieceHueStyleElement.textContent = `
                #board .square-${selectedPieceSquare} img {
                    filter: drop-shadow(0 0 6px ${bestMoveColorForHue}) drop-shadow(0 0 12px ${bestMoveColorForHue});
                    transform: scale(1.03);
                    transition: transform 0.05s ease-in-out;
                }
            `;
        }
    }
}

function highlightLegalMoves(pieceSq) {
    clearHighlights();
    selectedPieceSquare = pieceSq;

    const moves = game.moves({ square: pieceSq, verbose: true });
    if (moves.length === 0) return;

    if (!engine) {
        statusMessage("Engine not ready for evaluation. Displaying legal moves only.");
        moves.forEach(move => {
            $(`#board .square-${move.to}`).css('background-color', 'rgba(0, 255, 0, 0.2)');
        });
        currentHighlightSquaresInfo = moves.map(m => ({square: m.to, moveSAN: m.san, score:0, originalFen: game.fen()})); // Store for clearing
        return;
    }

    activeHighlightRequests = moves.length;
    engineStatusMessage(`Evaluating ${moves.length} moves for ${pieceSq}...`);

    const baseFen = game.fen(); // FEN before any of these potential moves

    moves.forEach(legalMove => {
        const tempGame = new Chess(baseFen);
        tempGame.move(legalMove.san); // Make the move in a temporary instance
        const fenAfterMove = tempGame.fen();

        moveEvalCache[fenAfterMove] = {
            targetSquare: legalMove.to,
            moveSAN: legalMove.san,
            originalFen: baseFen
        };

        sendToStockfish(`position fen ${fenAfterMove}`);
        sendToStockfish("go depth 1"); // Very shallow search for speed
    });
}

// --- Chessboard Event Handlers ---
function onDragStart(source, piece, position, orientation) {
    if (game.isGameOver()) return false;
    if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
        (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
        return false;
    }

    // Clear any previous highlights and reset selected piece square styling
    clearHighlights(); // Clear old ones before starting new ones
    highlightLegalMoves(source);
    return true;
}

function onDrop(source, target) {
    clearHighlights(); // Clear highlights from onDragStart

    let moveDetail = { from: source, to: target, promotion: 'q' };
    let moveResult = game.move(moveDetail);

    if (moveResult === null) {
        selectedPieceSquare = null; // Reset if move is invalid
        return 'snapback';
    }

    updateBoardPosition(game.fen(), true); // true for player move (less animation)
    selectedPieceSquare = null; // Reset after a successful move

    if (game.isGameOver()) return;

    if (engine) {
        statusMessage("Thinking...");
        sendToStockfish(`position fen ${game.fen()}`);
        sendToStockfish("go depth 10");
    } else {
        statusMessage("Engine not initialized. Cannot make AI move.");
    }
}

function onSnapEnd() {
    // This is called after a piece snaps back or a legal move animation finishes.
    // Ensure board is visually in sync.
    if (board && game && game.fen()) {
        board.position(game.fen());
    }
    // Highlights should be cleared by onDrop or new onDragStart.
    // If a drag is initiated and then cancelled (e.g. mouseup outside board),
    // onDrop might not fire. onDragStart clears, so this should be okay.
}

// --- Stockfish Integration ---
function initEngine() {
    statusMessage("Initializing Stockfish...");
    try {
        const wasmSupported = typeof WebAssembly === 'object' && WebAssembly.validate(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));
        const stockfishPath = wasmSupported ? 'stockfish.wasm.js' : 'stockfish.js';
        // Ensure path is relative to HTML file if stockfish files are in root.
        // If in a subfolder like 'stockfish_engine/', use 'stockfish_engine/stockfish.wasm.js'
        engine = new Worker(stockfishPath);

        engine.addEventListener('message', function (e) { handleEngineMessage(e.data); });
        engine.addEventListener('error', function(err) {
            console.error("Stockfish Worker Error:", err);
            engineStatusMessage(`Worker error. Check console, file paths for Stockfish, and ensure files are served correctly.`);
            statusMessage("<b>Error:</b> Engine failed. Ensure Stockfish JS files (stockfish.js/stockfish.wasm.js) are in the root directory and accessible via HTTP/S, not file:// protocol.");
            engine = null;
        });
        engine.postMessage('uci');
        engineStatusMessage("Stockfish worker created. Sent UCI, waiting for uciok...");
    } catch (error) {
        console.error("Error during Stockfish Worker creation:", error);
        engineStatusMessage("Stockfish init error: " + error.message + ". Check paths & ensure files are served.");
        statusMessage("<b>Error:</b> Engine unavailable. Ensure Stockfish JS files are present.");
        engine = null;
    }
}

function handleEngineMessage(data) {
    console.log("UCI: " + data);
    if (data === "uciok") {
        engineStatusMessage("UCI OK. Setting options and sending isready...");
        sendToStockfish("setoption name UCI_Chess960 value true");
        sendToStockfish("setoption name Contempt value 0");
        // sendToStockfish("setoption name Skill Level value 5");
        // sendToStockfish("setoption name Threads value 2");
        // sendToStockfish("setoption name Hash value 128");
        sendToStockfish("isready");
    } else if (data === "readyok") {
        engineStatusMessage("Engine ready.");
        if (currentFen) { // If a game was loaded/started before 'readyok'
            sendToStockfish(`position fen ${currentFen}`);
             // If it's AI's turn after setup (e.g. player loaded FEN where AI moves)
            if (game.turn() !== 'w') { // Assuming player is White
                 statusMessage("Thinking...");
                 sendToStockfish("go depth 10");
            }
        }
    } else if (data.startsWith("info") && data.includes("score cp")) {
        const parts = data.split(" ");
        let scoreCp = 0;
        let mateScore = null;

        for (let i = 0; i < parts.length; i++) {
            if (parts[i] === "cp" && i + 1 < parts.length) {
                scoreCp = parseInt(parts[i+1]);
                break;
            }
            if (parts[i] === "mate" && i + 1 < parts.length) {
                mateScore = parseInt(parts[i+1]);
                // Convert mate score to a large centipawn equivalent for simplicity
                // Positive mate for current player, negative mate for opponent
                scoreCp = (mateScore > 0 ? 1 : -1) * (10000 - Math.abs(mateScore) * 100);
                break;
            }
        }

        // This part attempts to link the score back to the move being evaluated.
        // It relies on Stockfish processing `position` and `go depth 1` commands sequentially
        // and that the `info` message arrives before the next `position` command is sent.
        // This is a simplification. A robust solution might involve tagging commands or a queue.

        // Find the FEN in moveEvalCache that hasn't received a score yet.
        // This assumes only one "go depth 1" is active at a time for highlighting evals.
        const fenKeyForEval = Object.keys(moveEvalCache).find(key =>
            moveEvalCache[key] && typeof moveEvalCache[key].score === 'undefined'
        );

        if (fenKeyForEval && moveEvalCache[fenKeyForEval]) {
            const moveContext = moveEvalCache[fenKeyForEval];

            // Score from Stockfish is for the player whose turn it is in fenAfterMove.
            // We need to adjust the score to be from the perspective of the player *making* the highlighted move.
            const originalPlayerTurn = new Chess(moveContext.originalFen).turn();
            const turnInEvaluatedFen = new Chess(fenKeyForEval).turn();

            let adjustedScore = scoreCp;
            // If the turn changed, it means the score is from the opponent's perspective.
            if (originalPlayerTurn !== turnInEvaluatedFen) {
                adjustedScore = -scoreCp;
            }

            currentHighlightSquaresInfo.push({
                 square: moveContext.targetSquare,
                 moveSAN: moveContext.moveSAN,
                 score: adjustedScore,
                 originalFen: moveContext.originalFen // For context or debugging
            });

            delete moveEvalCache[fenKeyForEval]; // Mark as processed
            activeHighlightRequests--;

            if (activeHighlightRequests <= 0) { // Use <= 0 for safety
                 engineStatusMessage("Evaluations complete.");
                 applyHighlights();
                 activeHighlightRequests = 0; // Ensure it's reset
            } else {
                 engineStatusMessage(`Evaluating... ${activeHighlightRequests} remaining.`);
            }
        }

    } else if (data.startsWith("bestmove")) {
        clearHighlights();
        const parts = data.split(" ");
        const bestMoveNotation = parts[1];

        if (bestMoveNotation === '(none)') {
            statusMessage("Stockfish returned (none). Game might be over or no legal moves.");
            return;
        }

        let moveDetail = { from: bestMoveNotation.substring(0,2), to: bestMoveNotation.substring(2,4) };
        if (bestMoveNotation.length === 5) moveDetail.promotion = bestMoveNotation.substring(4);

        const moveResult = game.move(moveDetail);
        if (moveResult) {
            updateBoardPosition(game.fen());
        } else {
            console.error("Stockfish proposed an illegal move that chess.js rejected:", bestMoveNotation, "Current FEN:", game.fen());
            statusMessage("<b>Error:</b> Stockfish proposed an illegal move. Please check console.");
        }
    }
}

function sendToStockfish(command) {
    if (engine) {
        // console.log("Sending to Stockfish:", command); // Can be too verbose
        engine.postMessage(command);
    } else {
        if (!command.includes("uci") && !command.includes("isready")) {
             engineStatusMessage("Offline. Cannot process: " + command);
        }
    }
}

// --- Initialization ---
$(document).ready(function() {
    pieceHueStyleElement = document.createElement('style');
    document.head.appendChild(pieceHueStyleElement);

    const boardConfig = {
        draggable: true,
        position: 'start',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd,
        moveSpeed: 'fast',
        snapbackSpeed: 500,
        snapSpeed: 100,
        appearSpeed: 'fast'
    };
    board = Chessboard('board', boardConfig);

    $('#setFenButton').on('click', function() {
        const fen = $('#fenInput').val();
        if (fen && fen.trim() !== "") {
            startNewGame(fen.trim());
        } else {
            statusMessage("FEN input is empty.");
        }
    });

    $('#newGameButton').on('click', function() {
        startNewGame();
    });

    initEngine();

    startNewGame(PREDEFINED_FENS[0]);

    $(window).resize(function() {
      if(board) board.resize();
    });
});
