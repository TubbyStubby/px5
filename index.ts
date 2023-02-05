import hook from 'require-in-the-middle';
import shimmer from 'shimmer';

/** Used to track function is patched or not to avoid patching it multiple times. */
const wrapSymbol = Symbol('px5wrapped');

/** Used to store path stack in req. */
const PX5_PATH_STACK = "__px5PathStack";

/** Used to store current mount path in req. */
const PX5_PATH = "__px5Path";

/** Used to determine if stack is frozen or not. */
const PX5_PATH_STACK_FREEZE = "__px5PathStackFreeze";

type PatchInfo = {
    patched: boolean;
};

type WrapInfo = {
    path: string;
};

type WrappedFunction = {
    [wrapSymbol]?: boolean;
    (...args: any[]): any;
}

/** Type for a request which has px5 properties added to it */
export type Px5Request = Express.Request & { [PX5_PATH]?: string, [PX5_PATH_STACK]?: (string|RegExp)[], [PX5_PATH_STACK_FREEZE]?: boolean };
/** Type for a response with some extra properties */
export type Px5Response = Express.Response & { __wrapped: boolean, send: (...args: any[]) => any };

/** Used to store info related to current patch of express. */
const patchInfo: PatchInfo = { patched: false };

/** express's mounting methods which are needed to be patched. */
const methods = ['use', 'get', 'post', 'put', 'delete', 'patch'];

/** This function pacthes express. */
export function patch() {
    hook(['express'], function (exports: any, name: any, basedir: any) {
        if (patchInfo.patched) return exports;
        for(const method of methods) {
            shimmer.wrap(exports.application, method, wrapMethod);
            shimmer.wrap(exports.Router, method, wrapMethod);
        }
        patchInfo.patched = true;
        return exports;
    });
}

/**
 * Wraps function such that all the arguments passed to are checked for string/regex or function or array of either those.
 * - If it is string/regex or array of those then its considered mount path after converting to string
 * - if it is function or array of functions then functions are warpped using wrapArgs
 * 
 * finally original function is called and its return value is returned.
 */
function wrapMethod(original: () => any) {
    if(original.__wrapped) return original;
    const wrapped = function (...args: any[]) {
        let path = args[0];
        const isRouteArrayOfFunctions = path instanceof Array && typeof path[0] == 'function';
        if(typeof path != 'function' && !isRouteArrayOfFunctions) path = String(path);
        //@ts-ignore
        if(!path) return original.apply(this, args);
        const info: WrapInfo = { path };
        wrapArgs(args, info);
        // @ts-ignore
        return original.apply(this, args);
    }
    mimicFunction(original, wrapped);
    return wrapped;
}

/** Checks and wraps middleware functions */
function wrapArgs(args: any[], info: WrapInfo) {
    for(let i = 1; i < args.length; i++) {
        const middleware = args[i];
        if(typeof middleware == 'function') {
            const wrapped = wrapMiddlewares(middleware, info);
            if(wrapped != middleware) args[i] = wrapped;
        } else if(middleware instanceof Array && typeof middleware[0] == 'function') {
            wrapArgs(middleware, info);
        }
    }
}

/**
 * Wraps function to find position for req, res, next in function arguments and performs these actions
 * - req: adds stack if not present and pushes the mount path if stack not frozen 
 * - res: wraps it
 * - next: wraps it
 */
function wrapMiddlewares(original: WrappedFunction, info: WrapInfo) {
    if(original[wrapSymbol]) return original;
    const arity = original.length;
    let reqIdx: number|undefined;
    let nextIdx: number|undefined;
    let resIdx: number|undefined;
    if(arity == 2) {
        reqIdx = 0;
        resIdx = 1;
    } else if (arity == 3) {
        reqIdx = 0;
        resIdx = 1;
        nextIdx = 2;
    } else if (arity == 4) {
        reqIdx = 1;
        resIdx = 2;
        nextIdx = 3;
    }
    if(typeof reqIdx == undefined) return original;
    let wrapped: WrappedFunction = function (...args) {
        const req: Px5Request|null = typeof reqIdx == 'number' ? args[reqIdx] : null;
        const next = typeof nextIdx == 'number' ? args[nextIdx] : null;
        const res: Px5Response|null = typeof resIdx == 'number' ? args[resIdx] : null;
        //@ts-ignore
        if(!req) return original.apply(this, args);
        req[PX5_PATH] = info.path;
        if(!req[PX5_PATH_STACK_FREEZE]) {
            if(!req[PX5_PATH_STACK]) req[PX5_PATH_STACK] = [];
            req[PX5_PATH_STACK].push(info.path);
        }
        if(next && nextIdx) {
            const wrappedNext = wrapNext(next, req, info);
            if(next != wrappedNext) args[nextIdx] = wrappedNext;
        }
        if(res) wrapResSend(res, req, info);
        //@ts-ignore
        const returnValue = original.apply(this, args);
        return returnValue;
    }
    mimicFunction(original, wrapped);
    wrapped[wrapSymbol] = true;
    return wrapped;
}

/** Wraps it such that whenever next is called and if path stack is not frozen then pops the path */
function wrapNext(original: WrappedFunction, req: Px5Request, info: WrapInfo) {
    if(original[wrapSymbol]) return original;
    const wrapped: WrappedFunction = function (...args: any[]) {
        const isError = args[0] instanceof Error;
        if(!req[PX5_PATH_STACK_FREEZE] && !isError) req[PX5_PATH_STACK]?.pop();
        //@ts-ignore
        return original.apply(this, args);
    }
    mimicFunction(original, wrapped);
    wrapped[wrapSymbol] = true;
    return wrapped;
}

/** Wraps send to freeze path stack whenever it is called */
function wrapResSend(res: Px5Response, req: Px5Request, info: WrapInfo) {
    shimmer.wrap(res, 'send', function (original: (...args: any[]) => any) {
        if(original.__wrapped) return original;
        const wrapped = function (...args: any[]) {
            freezeStack(req);
            // @ts-ignore
            return original.apply(this, args);
        }
        mimicFunction(original, wrapped);
        return wrapped;
    });
}

/** Copies name and length properties from source to destination */
function mimicFunction(original: () => any, mime: () => any) {
    const originalNameDesc = Object.getOwnPropertyDescriptor(original, 'name');
    if(originalNameDesc) Object.defineProperty(mime, 'name', originalNameDesc);
    const originalLengthDesc = Object.getOwnPropertyDescriptor(original, 'length');
    if(originalLengthDesc) Object.defineProperty(mime, 'length', originalLengthDesc);
}

/** Combines paths in the stack to form complete route. This will fix any extra leading and trailing slash '/'. */
export function getNormalizedPath(req: Px5Request) {
    if(req[PX5_PATH_STACK] && req[PX5_PATH_STACK].length > 0) {
        let path = req[PX5_PATH_STACK].join('');
        path = '/' + path.replace(/^(?:\/+)([^/])/, '$1').replace(/\/+$/, '');
        return path;
    }
}

export function isStackFrozen(req: Px5Request) {
    return !!req[PX5_PATH_STACK_FREEZE];
}

export function freezeStack(req: Px5Request) {
    req[PX5_PATH_STACK_FREEZE] = true;
}