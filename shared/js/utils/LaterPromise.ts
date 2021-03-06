export class LaterPromise<T> extends Promise<T> {
    private readonly _time: number;
    private readonly _handle: Promise<T>;
    private _resolve: ($: T) => any;
    private _reject: ($: any) => any;

    constructor() {
        super((resolve, reject) => {});
        this._handle = new Promise<T>((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
        this._time = Date.now();
    }

    resolved(object: T) {
        this._resolve(object);
    }

    rejected(reason) {
        this._reject(reason);
    }

    function_rejected() {
        return error => this.rejected(error);
    }

    time() { return this._time; }

    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
                                         onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2> {
        return this._handle.then(onfulfilled, onrejected);
    }

    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult> {
        return this._handle.then(onrejected);
    }
}