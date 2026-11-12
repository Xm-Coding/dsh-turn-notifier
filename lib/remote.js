var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
/**
 * Host service for notification actions. The service reads its runtime from
 * the Cordis plugin config so the registry and router stay owned by the
 * plugin fiber.
 */
let TurnNotifierActions = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _ping_decorators;
    let _registerClient_decorators;
    let _claimAction_decorators;
    let _completeAction_decorators;
    return class TurnNotifierActions extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _ping_decorators = [Remote('ping')];
            _registerClient_decorators = [Remote('registerClient')];
            _claimAction_decorators = [Remote('claimAction')];
            _completeAction_decorators = [Remote('completeAction')];
            __esDecorate(this, null, _ping_decorators, { kind: "method", name: "ping", static: false, private: false, access: { has: obj => "ping" in obj, get: obj => obj.ping }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _registerClient_decorators, { kind: "method", name: "registerClient", static: false, private: false, access: { has: obj => "registerClient" in obj, get: obj => obj.registerClient }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _claimAction_decorators, { kind: "method", name: "claimAction", static: false, private: false, access: { has: obj => "claimAction" in obj, get: obj => obj.claimAction }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _completeAction_decorators, { kind: "method", name: "completeAction", static: false, private: false, access: { has: obj => "completeAction" in obj, get: obj => obj.completeAction }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        runtime = __runInitializers(this, _instanceExtraInitializers);
        constructor(ctx, runtime) {
            super(ctx, 'turnNotifierActions', { namespace: 'turnNotifier' });
            this.runtime = runtime;
        }
        /**
         * Prove that the generated Client contribution reaches this Host service.
         * @param signal - carrier cancellation.
         * @returns a fixed value; no notification data is involved.
         */
        ping(signal) {
            signal.throwIfAborted();
            return { pong: true };
        }
        /**
         * Register one authenticated Client connection. The Host assigns the
         * deployment identity; the Client does not supply it.
         * @param request - Client generation, current session and capabilities.
         * @param signal - carrier cancellation.
         */
        registerClient(request, signal) {
            signal.throwIfAborted();
            if (this.runtime === undefined)
                throw new Error('turn-notifier runtime is unavailable');
            return this.runtime.router.registerClient(request);
        }
        /**
         * Claim one pending action under a short Host lease.
         * @param request - Client generation and current session.
         * @param signal - carrier cancellation.
         */
        claimAction(request, signal) {
            signal.throwIfAborted();
            if (this.runtime === undefined)
                throw new Error('turn-notifier runtime is unavailable');
            return this.runtime.router.claimAction(request);
        }
        /**
         * Report the Client-side outcome of a claimed action.
         * @param request - client generation, action id and result.
         * @param signal - carrier cancellation.
         */
        completeAction(request, signal) {
            signal.throwIfAborted();
            if (this.runtime === undefined)
                throw new Error('turn-notifier runtime is unavailable');
            return this.runtime.router.completeAction(request);
        }
    };
})();
export { TurnNotifierActions };
