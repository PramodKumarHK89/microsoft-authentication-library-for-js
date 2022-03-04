/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { Logger, AuthError, AuthErrorMessage } from "@azure/msal-common";
import sinon from "sinon";
import { WamMessageHandler } from "../../src/broker/wam/WamMessageHandler";
import { BrowserAuthError, BrowserAuthErrorMessage } from "../../src/error/BrowserAuthError";
import { WamConstants, WamExtensionMethod } from "../../src/utils/BrowserConstants";
import { WamAuthError } from "../../src/error/WamAuthError";

describe("WamMessageHandler Tests", () => {
    let postMessageSpy: sinon.SinonSpy;
    let mcPort: MessagePort;
    globalThis.MessageChannel = require("worker_threads").MessageChannel; // jsdom does not include an implementation for MessageChannel

    beforeEach(() => {
        postMessageSpy = sinon.spy(window, "postMessage");
        sinon.stub(MessageEvent.prototype, "source").get(() => window); // source property not set by jsdom window messaging APIs
    });

    afterEach(() => {
        mcPort.close();
        sinon.restore();
    })

    describe("createProvider", () => {
        it("Sends handshake request to preferred extension which responds", async () => {
            const eventHandler = function (event: MessageEvent) {
                event.stopImmediatePropagation();
                const request = event.data;
                const req  = {
                    channel: "53ee284d-920a-4b59-9d30-a60315b26836",
                    extensionId: "test-ext-id",
                    responseId: request.responseId,
                    body: {
                        method: "HandshakeResponse",
                        version: 3
                    }
                };

                mcPort = postMessageSpy.args[0][2][0];
                if (!mcPort) {
                    throw new Error("MessageChannel port was not transferred");
                }
                mcPort.postMessage(req);
            };

            window.addEventListener("message", eventHandler, true);

            const wamMessageHandler = await WamMessageHandler.createProvider(new Logger({}));
            expect(wamMessageHandler).toBeInstanceOf(WamMessageHandler);

            window.removeEventListener("message", eventHandler, true);
        });

        it("Sends handshake to any extension if preferred extension is not installed", async () => {
            const eventHandler = function (event: MessageEvent) {
                if (event.data.extensionId) {
                    // Don't handle handshake requests for preferred extension so we can test the backup request
                    return;
                }

                event.stopImmediatePropagation();
                const request = event.data;
                const req  = {
                    channel: "53ee284d-920a-4b59-9d30-a60315b26836",
                    extensionId: "test-ext-id",
                    responseId: request.responseId,
                    body: {
                        method: "HandshakeResponse",
                        version: 3
                    }
                };

                mcPort = postMessageSpy.args[1][2][0];
                if (!mcPort) {
                    throw new Error("MessageChannel port was not transferred");
                }
                mcPort.postMessage(req);
            };

            window.addEventListener("message", eventHandler, true);

            const wamMessageHandler = await WamMessageHandler.createProvider(new Logger({}));
            expect(wamMessageHandler).toBeInstanceOf(WamMessageHandler);

            window.removeEventListener("message", eventHandler, true);
        });

        it("Throws if no extension is installed", (done) => {
            WamMessageHandler.createProvider(new Logger({})).catch((e) => {
                expect(e).toBeInstanceOf(BrowserAuthError);
                expect(e.errorCode).toBe(BrowserAuthErrorMessage.wamExtensionNotInstalled.code);
                expect(e.errorMessage).toBe(BrowserAuthErrorMessage.wamExtensionNotInstalled.desc);
                done();
            });
        });

        it("Throws timeout error if no extension responds to handshake", (done) => {
            const eventHandler = function (event: MessageEvent) {
                event.stopImmediatePropagation();
            };

            window.addEventListener("message", eventHandler, true);

            WamMessageHandler.createProvider(new Logger({})).catch((e) => {
                expect(e).toBeInstanceOf(BrowserAuthError);
                expect(e.errorCode).toBe(BrowserAuthErrorMessage.wamHandshakeTimeout.code);
                expect(e.errorMessage).toBe(BrowserAuthErrorMessage.wamHandshakeTimeout.desc);
                done();
            }).finally(() => {
                window.removeEventListener("message", eventHandler, true);
            });
        });
    });

    describe("sendMessage", () => {
        it("Sends message to WAM extension", async () => {
            const testResponse = {
                status: "Success",
                result: {
                    accessToken: "test-access-token"
                }
            };
            const eventHandler = function (event: MessageEvent) {
                event.stopImmediatePropagation();
                const request = event.data;
                const req  = {
                    channel: "53ee284d-920a-4b59-9d30-a60315b26836",
                    extensionId: "test-ext-id",
                    responseId: request.responseId,
                    body: {
                        method: "HandshakeResponse",
                        version: 3
                    }
                };

                mcPort = postMessageSpy.args[0][2][0];
                if (!mcPort) {
                    throw new Error("MessageChannel port was not transferred");
                }
                mcPort.onmessage = (event) => {
                    expect(event.data.body.method).toBe(WamExtensionMethod.GetToken);
                    mcPort.postMessage({
                        channelId: "53ee284d-920a-4b59-9d30-a60315b26836",
                        extensionId: "test-ext-id",
                        responseId: event.data.responseId,
                        body: {
                            method: "Response",
                            response: testResponse
                        }
                    })
                }
                mcPort.postMessage(req);
            };

            window.addEventListener("message", eventHandler, true);

            const wamMessageHandler = await WamMessageHandler.createProvider(new Logger({}));
            expect(wamMessageHandler).toBeInstanceOf(WamMessageHandler);

            const response = await wamMessageHandler.sendMessage({method: WamExtensionMethod.GetToken});
            expect(response).toEqual(testResponse.result);

            window.removeEventListener("message", eventHandler, true);
        });

        it("Sends message to WAM extension and throws if error is returned", (done) => {
            const testResponse = {
                status: "Fail",
                code: "NoSupport",
                description: "This method is not supported"
            };
            const eventHandler = function (event: MessageEvent) {
                event.stopImmediatePropagation();
                const request = event.data;
                const req  = {
                    channel: "53ee284d-920a-4b59-9d30-a60315b26836",
                    extensionId: "test-ext-id",
                    responseId: request.responseId,
                    body: {
                        method: "HandshakeResponse",
                        version: 3
                    }
                };

                mcPort = postMessageSpy.args[0][2][0];
                if (!mcPort) {
                    throw new Error("MessageChannel port was not transferred");
                }
                mcPort.onmessage = (event) => {
                    expect(event.data.body.method).toBe(WamExtensionMethod.GetToken);
                    mcPort.postMessage({
                        channelId: "53ee284d-920a-4b59-9d30-a60315b26836",
                        extensionId: "test-ext-id",
                        responseId: event.data.responseId,
                        body: {
                            method: "Response",
                            response: testResponse
                        }
                    })
                }
                mcPort.postMessage(req);
            };

            window.addEventListener("message", eventHandler, true);

            WamMessageHandler.createProvider(new Logger({})).then((wamMessageHandler) => {
                wamMessageHandler.sendMessage({method: WamExtensionMethod.GetToken}).catch((e) => {
                    expect(e).toBeInstanceOf(WamAuthError);
                    expect(e.errorCode).toEqual(testResponse.code);
                    expect(e.errorMessage).toEqual(testResponse.description);
                    done();
                });
            }).finally(() => {
                window.removeEventListener("message", eventHandler, true);
            });
        });

        it("Sends message to WAM extension and throws if response.status is 'Success' but there are code and description properties in the result", (done) => {
            const testResponse = {
                status: "Success",
                result: {
                    code: "NoSupport",
                    description: "This method is not supported"
                }
            };
            const eventHandler = function (event: MessageEvent) {
                event.stopImmediatePropagation();
                const request = event.data;
                const req  = {
                    channel: "53ee284d-920a-4b59-9d30-a60315b26836",
                    extensionId: "test-ext-id",
                    responseId: request.responseId,
                    body: {
                        method: "HandshakeResponse",
                        version: 3
                    }
                };

                mcPort = postMessageSpy.args[0][2][0];
                if (!mcPort) {
                    throw new Error("MessageChannel port was not transferred");
                }
                mcPort.onmessage = (event) => {
                    expect(event.data.body.method).toBe(WamExtensionMethod.GetToken);
                    mcPort.postMessage({
                        channelId: "53ee284d-920a-4b59-9d30-a60315b26836",
                        extensionId: "test-ext-id",
                        responseId: event.data.responseId,
                        body: {
                            method: "Response",
                            response: testResponse
                        }
                    })
                }
                mcPort.postMessage(req);
            };

            window.addEventListener("message", eventHandler, true);

            WamMessageHandler.createProvider(new Logger({})).then((wamMessageHandler) => {
                wamMessageHandler.sendMessage({method: WamExtensionMethod.GetToken}).catch((e) => {
                    expect(e).toBeInstanceOf(WamAuthError);
                    expect(e.errorCode).toEqual(testResponse.result.code);
                    expect(e.errorMessage).toEqual(testResponse.result.description);
                    done();
                });
            }).finally(() => {
                window.removeEventListener("message", eventHandler, true);
            });
        });

        it("Sends message to WAM extension and throws if response does not contain a result property", (done) => {
            const testResponse = {
                status: "Success"
            };
            const eventHandler = function (event: MessageEvent) {
                event.stopImmediatePropagation();
                const request = event.data;
                const req  = {
                    channel: "53ee284d-920a-4b59-9d30-a60315b26836",
                    extensionId: "test-ext-id",
                    responseId: request.responseId,
                    body: {
                        method: "HandshakeResponse",
                        version: 3
                    }
                };

                mcPort = postMessageSpy.args[0][2][0];
                if (!mcPort) {
                    throw new Error("MessageChannel port was not transferred");
                }
                mcPort.onmessage = (event) => {
                    expect(event.data.body.method).toBe(WamExtensionMethod.GetToken);
                    mcPort.postMessage({
                        channelId: "53ee284d-920a-4b59-9d30-a60315b26836",
                        extensionId: "test-ext-id",
                        responseId: event.data.responseId,
                        body: {
                            method: "Response",
                            response: testResponse
                        }
                    })
                }
                mcPort.postMessage(req);
            };

            window.addEventListener("message", eventHandler, true);

            WamMessageHandler.createProvider(new Logger({})).then((wamMessageHandler) => {
                wamMessageHandler.sendMessage({method: WamExtensionMethod.GetToken}).catch((e) => {
                    expect(e).toBeInstanceOf(AuthError);
                    expect(e.errorCode).toEqual(AuthErrorMessage.unexpectedError.code);
                    expect(e.errorMessage).toContain(AuthErrorMessage.unexpectedError.desc);
                    done();
                });
            }).finally(() => {
                window.removeEventListener("message", eventHandler, true);
            });
        });
    });
});