/** Bounds optional SDK reads without importing a runtime dependency into the extension. */
export async function readWithTimeout(read, ms) {
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(read),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("Session read timed out.")), ms);
                timer.unref?.();
            }),
        ]);
    }
    finally {
        clearTimeout(timer);
    }
}
