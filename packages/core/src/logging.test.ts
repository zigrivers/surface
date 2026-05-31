import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  createSurfaceLogger,
  REDACTED_LOG_KEY,
  sanitizeLogFields,
  TRUNCATED_LOG_VALUE,
} from "./logging.js";

class UserWithPassword {
  readonly password = "plain-text";
}

class MemoryStream extends Writable {
  readonly lines: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error) => void,
  ) {
    this.lines.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    callback();
  }
}

describe("surface logger", () => {
  it("redacts secrets and captured content from nested log fields", () => {
    const circularArtifact: Record<string, unknown> = { path: ".surface/captures/dom.html" };
    circularArtifact.self = circularArtifact;

    const sanitized = sanitizeLogFields({
      runId: "run_1",
      eventId: "evt_1",
      status: "completed",
      domain: "app.example.com",
      authState: "/tmp/playwright-storage-state.json",
      openAiApiKey: "sk-test",
      emptyToken: null,
      missingToken: undefined,
      authKey: "opaque-auth",
      mySecretData: "opaque-secret",
      secretData: "opaque-secret",
      secretKey: "secret-key",
      user: new UserWithPassword(),
      capture: {
        dom: "<button>Submit</button>",
        screenshot: "base64-png",
        sourceCode: "export const secret = true;",
        artifacts: [
          { path: ".surface/captures/dom.html", redacted: true },
          { token: "ghp_secret" },
          circularArtifact,
        ],
      },
    });

    expect(sanitized).toEqual({
      runId: "run_1",
      eventId: "evt_1",
      status: "completed",
      domain: "app.example.com",
      authState: "[Redacted]",
      openAiApiKey: "[Redacted]",
      emptyToken: null,
      missingToken: undefined,
      authKey: "[Redacted]",
      mySecretData: "[Redacted]",
      secretData: "[Redacted]",
      secretKey: "[Redacted]",
      user: { password: "[Redacted]" },
      capture: {
        dom: "[Redacted]",
        screenshot: "[Redacted]",
        sourceCode: "[Redacted]",
        artifacts: [
          { path: ".surface/captures/dom.html", redacted: true },
          { token: "[Redacted]" },
          { path: ".surface/captures/dom.html", self: "[Circular]" },
        ],
      },
    });
  });

  it("uses pino and redacts unsafe fields before writing JSON logs", () => {
    const stream = new MemoryStream();
    const logger = createSurfaceLogger({
      level: "info",
      runId: "run_2",
      stream,
    });

    logger.info({
      eventId: "evt_2",
      event: "CaptureCompleted",
      durationMs: 12,
      domSnapshot: "<html>private</html>",
      headers: { authorization: "Bearer secret" },
      responseHeaders: { "set-cookie": "session=abc" },
      dynamicKeys: {
        ghp_dynamic_secret: "value",
        ghp_dynamic_secret2: "value",
      },
      dangerousSerializer: {
        safe: "kept",
        toJSON() {
          return { token: "ghp_secret" };
        },
      },
    });

    const parsed = JSON.parse(stream.lines.join("")) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      level: 30,
      runId: "run_2",
      eventId: "evt_2",
      event: "CaptureCompleted",
      durationMs: 12,
      domSnapshot: "[Redacted]",
      headers: { authorization: "[Redacted]" },
      responseHeaders: { "set-cookie": "[Redacted]" },
      dynamicKeys: {
        [REDACTED_LOG_KEY]: "[Redacted]",
        [`${REDACTED_LOG_KEY}2`]: "[Redacted]",
      },
      dangerousSerializer: {
        token: "[Redacted]",
      },
    });
    expect(JSON.stringify(parsed)).not.toContain("private");
    expect(JSON.stringify(parsed)).not.toContain("Bearer secret");
  });

  it("redacts child bindings and string-first object arguments", () => {
    const stream = new MemoryStream();
    const logger = createSurfaceLogger({
      level: "info",
      stream,
    }).child({
      domain: "app.example.com",
      apiKey: "sk-test",
    });
    const specialBindings: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    specialBindings.normal = 1;

    Object.defineProperty(specialBindings, "hostile", {
      enumerable: true,
      get() {
        throw new Error("hidden ghp_secret");
      },
    });
    const specialLogger = logger.child(specialBindings);

    specialLogger.info("finished %o", {
      eventId: "evt_3",
      token: "ghp_secret",
      htmlSnapshot: "<html>private</html>",
    });

    const parsed = JSON.parse(stream.lines.join("")) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      domain: "app.example.com",
      apiKey: "[Redacted]",
      normal: 1,
      hostile: "[Redacted]",
    });
    expect(String(parsed.msg)).toContain('"token":"[Redacted]"');
    expect(String(parsed.msg)).toContain('"htmlSnapshot":"[Redacted]"');
    expect(JSON.stringify(parsed)).not.toContain("ghp_secret");
    expect(JSON.stringify(parsed)).not.toContain("private");

    const nullBindingStream = new MemoryStream();
    const nullBindingLogger = createSurfaceLogger({ level: "info", stream: nullBindingStream });
    nullBindingLogger.child(null as unknown as Record<string, unknown>).info("empty child");
    const nullBindingLine = JSON.parse(nullBindingStream.lines.join("")) as Record<string, unknown>;
    expect(nullBindingLine.msg).toBe("empty child");

    const specialStream = new MemoryStream();
    const specialTopLevelLogger = createSurfaceLogger({ level: "info", stream: specialStream });
    const specialFields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    specialFields["__proto__"] = "kept";
    Object.defineProperty(specialFields, "hasOwnProperty", {
      enumerable: true,
      value: "kept",
    });
    specialFields.normal = 1;

    specialTopLevelLogger.info(specialFields);

    const parsedSpecialFields = JSON.parse(specialStream.lines.join("")) as Record<string, unknown>;

    expect(Object.hasOwn(parsedSpecialFields, REDACTED_LOG_KEY)).toBe(true);
    expect(parsedSpecialFields[REDACTED_LOG_KEY]).toBe("[Redacted]");
    expect(parsedSpecialFields[`${REDACTED_LOG_KEY}2`]).toBe("[Redacted]");
    expect(parsedSpecialFields.normal).toBe(1);
  });

  it("preserves pino object-first messages and standard built-ins safely", () => {
    const stream = new MemoryStream();
    const logger = createSurfaceLogger({ level: "info", stream });

    logger.info(
      {
        at: new Date("2026-05-31T19:00:00.000Z"),
        error: new Error("failed with github_pat_abc123_secret"),
        pattern: /submit/i,
        url: new URL("https://app.example.com/path?token=secret"),
      },
      "User %s completed",
      "ada",
    );

    const parsed = JSON.parse(stream.lines.join("")) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      at: "2026-05-31T19:00:00.000Z",
      error: { name: "Error", message: "failed with [Redacted]" },
      pattern: "/submit/i",
      url: "https://app.example.com/path?token=[Redacted]",
      msg: "User ada completed",
    });
    expect(JSON.stringify(parsed)).not.toContain("secret-token");
    expect(JSON.stringify(parsed)).not.toContain("github_pat_abc123_secret");
  });

  it("sanitizes top-level errors, string URLs, JWTs, and empty child bindings", () => {
    const stream = new MemoryStream();
    const logger = createSurfaceLogger({ level: "info", stream }).child({}).child({
      parent: "kept",
    });
    const nestedLogger = logger.child({ child: "kept" });

    const customError = Object.assign(new Error("failed with bearer secret-token"), {
      code: "E_AUTH",
      auth: "AKIA1234567890ABCDEF",
    });

    nestedLogger.error(customError);
    nestedLogger.info({
      accessKey: "AKIA_TEST",
      author: "Ada",
      relativeUrl: "/api?token=secret&view=summary",
      oauthUrl: "https://app.example.com/callback#access_token=abc&refresh_token=def",
      callbackUrl: "https://app.example.com/callback?code=abc123&state=kept",
      protocolRelativeUrl: "//app.example.com/callback?access_token=abc#refresh_token=def",
      redirectUrl:
        "https://app.example.com/login?redirect=https%3A%2F%2Fapp.example.com%2Fcallback%3Faccess_token%3Dghp_secret",
      signedUrl: "https://storage.example.com/upload?X-Amz-Signature=sig-secret&view=kept",
      mapUrl: "https://maps.example.com/static?key=AIza-secret&size=400x400",
      duplicateParams: "https://app.example.com/path?view=one&view=two&token=secret",
      url: "https://admin:supersecret@app.example.com/path?token=secret#frag",
      note: "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature ASIA1234567890ABCDEF",
    });

    const [errorLine, infoLine] = stream.lines.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );

    expect(JSON.stringify(errorLine)).not.toContain("secret-token");
    expect(errorLine).toMatchObject({
      err: {
        name: "Error",
        message: "failed with [Redacted]",
        code: "E_AUTH",
        auth: "[Redacted]",
      },
    });
    expect(infoLine).toMatchObject({
      accessKey: "[Redacted]",
      author: "Ada",
      child: "kept",
      parent: "kept",
      oauthUrl: "https://app.example.com/callback#access_token=[Redacted]&refresh_token=[Redacted]",
      callbackUrl: "https://app.example.com/callback?code=[Redacted]&state=kept",
      protocolRelativeUrl:
        "//app.example.com/callback?access_token=[Redacted]#refresh_token=[Redacted]",
      duplicateParams: "https://app.example.com/path?view=one&view=two&token=[Redacted]",
      redirectUrl:
        "https://app.example.com/login?redirect=https%3A%2F%2Fapp.example.com%2Fcallback%3Faccess_token%3D[Redacted]",
      signedUrl: "https://storage.example.com/upload?X-Amz-Signature=[Redacted]&view=kept",
      mapUrl: "https://maps.example.com/static?key=[Redacted]&size=400x400",
      relativeUrl: "/api?token=[Redacted]&view=summary",
      url: "https://[Redacted]:[Redacted]@app.example.com/path?token=[Redacted]#frag",
      note: "jwt [Redacted] [Redacted]",
    });
    expect(JSON.stringify(errorLine)).not.toContain("AKIA1234567890ABCDEF");
    expect(JSON.stringify(infoLine)).not.toContain("signature");
    expect(JSON.stringify(infoLine)).not.toContain("ghp_secret");
  });

  it("keeps non-sensitive key names and handles hostile error accessors", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const longMessage = `${"x".repeat(9_000)} bearer secret-token`;
    const keyBlock = `prefix -----BEGIN PRIVATE KEY-----${"a".repeat(8_300)}-----END PRIVATE KEY----- suffix`;
    const sanitized = sanitizeLogFields({
      key: "Enter",
      keyboardShortcut: "Shift+Enter",
      authCode: "opaque-auth",
      authentication: "opaque-auth",
      authId: "opaque-auth",
      authorEmail: "ada@example.com",
      authorId: "user_1",
      authorName: "Ada",
      authorProfile: "browser automation lead",
      authorBio: "writes integration tests",
      discretion: "kept",
      filePath: "/usr/bin/node",
      keyValueUrl: "url=/path?token=secret path:/path?token=secret",
      malformedUrl: "https://[bad]?token=abc",
      sessionId: "session-123",
      secretaries: 2,
      tokenValue: "opaque-token",
      tokenizedCount: 3,
      sessionToken: "ghp_secret",
      bytes,
      binarySecret: Buffer.from("ghp_secret"),
      bigNumber: 123n,
      symbolValue: Symbol("ghp_secret"),
      weakValues: new WeakMap<object, unknown>(),
      plainWeakSet: new WeakSet<object>(),
      longMessage,
      punctuatedUrl: "See https://example.com/path?token=abc.",
      keyBlock,
      publicThenPrivateBlock:
        "prefix -----BEGIN PUBLIC KEY-----pub-----END PUBLIC KEY----- middle -----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY----- suffix",
      note: "glpat_secret",
      fineGrainedToken: "github_pat_abc123_secret",
      standaloneValues: ["secret-token", "supersecret", "opaque-auth"],
      mapData: new Map<unknown, unknown>([
        ["apiKey", "sk-secret"],
        ["ghp_foo", "value"],
        ["safe", 1],
      ]),
      hostileKeyMap: new Map<unknown, unknown>([
        [
          {
            toString() {
              throw new Error("hidden secret-token");
            },
          },
          "value",
        ],
        ["safe", 1],
      ]),
    });

    expect(sanitized).toMatchObject({
      key: "Enter",
      keyboardShortcut: "Shift+Enter",
      authCode: "[Redacted]",
      authentication: "[Redacted]",
      authId: "[Redacted]",
      authorEmail: "ada@example.com",
      authorId: "user_1",
      authorName: "Ada",
      authorProfile: "browser automation lead",
      authorBio: "writes integration tests",
      discretion: "kept",
      filePath: "/usr/bin/node",
      keyValueUrl: "url=/path?token=[Redacted] path:/path?token=[Redacted]",
      malformedUrl: "https://[bad]?token=[Redacted]",
      sessionId: "[Redacted]",
      secretaries: 2,
      tokenValue: "[Redacted]",
      tokenizedCount: 3,
      sessionToken: "[Redacted]",
      binarySecret: "[Redacted]",
      bigNumber: "123",
      symbolValue: "[Redacted]",
      weakValues: "[Redacted]",
      plainWeakSet: "[Redacted]",
      note: "[Redacted]",
      fineGrainedToken: "[Redacted]",
      standaloneValues: ["[Redacted]", "[Redacted]", "[Redacted]"],
    });
    expect(sanitized.bytes).toBe("[Redacted]");
    expect(String(sanitized.longMessage)).toHaveLength(8_192 + TRUNCATED_LOG_VALUE.length);
    expect(String(sanitized.longMessage)).toContain(TRUNCATED_LOG_VALUE);
    expect(String(sanitized.longMessage)).not.toContain("secret-token");
    expect(sanitized.punctuatedUrl).toBe("See https://example.com/path?token=[Redacted].");
    expect(sanitized.keyBlock).toBe("prefix [Redacted] suffix");
    expect(sanitized.publicThenPrivateBlock).toBe(
      "prefix -----BEGIN PUBLIC KEY-----pub-----END PUBLIC KEY----- middle [Redacted] suffix",
    );
    expect(
      sanitizeLogFields({
        pemBlocks:
          "a -----BEGIN PRIVATE KEY-----one-----END PRIVATE KEY----- b -----BEGIN PRIVATE KEY-----two-----END PRIVATE KEY----- c",
      }).pemBlocks,
    ).toBe("a [Redacted] b [Redacted] c");
    expect(
      sanitizeLogFields({
        oneLinePem: "-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----",
      }).oneLinePem,
    ).toBe("[Redacted]");
    expect(
      sanitizeLogFields({
        rsaPem: "before -----BEGIN RSA PRIVATE KEY-----secret-----END RSA PRIVATE KEY----- after",
      }).rsaPem,
    ).toBe("before [Redacted] after");
    expect(
      sanitizeLogFields({
        missingPemEnd: "prefix -----BEGIN PRIVATE KEY-----secret",
      }).missingPemEnd,
    ).toBe("prefix [Redacted]");
    expect(
      sanitizeLogFields({
        publicOnly: "-----BEGIN PUBLIC KEY-----pub-----END PUBLIC KEY-----",
      }).publicOnly,
    ).toBe("-----BEGIN PUBLIC KEY-----pub-----END PUBLIC KEY-----");

    const boundarySecret = String(
      sanitizeLogFields({
        boundarySecret: `${"x".repeat(8_188)} bearer ${"s".repeat(64)}`,
      }).boundarySecret,
    );

    expect(boundarySecret).not.toContain("bearer");
    expect(boundarySecret).not.toContain("ssss");
    expect(sanitized.mapData).toEqual({
      apiKey: "[Redacted]",
      [REDACTED_LOG_KEY]: "[Redacted]",
      safe: 1,
    });
    expect(sanitized.hostileKeyMap).toEqual({
      [REDACTED_LOG_KEY]: "value",
      safe: 1,
    });

    expect(
      sanitizeLogFields({
        "password:hunter2": "value",
        "token=abc123": "value",
      }),
    ).toEqual({
      [REDACTED_LOG_KEY]: "[Redacted]",
      [`${REDACTED_LOG_KEY}2`]: "[Redacted]",
    });
    expect(
      sanitizeLogFields({
        inlineMap: new Map<unknown, unknown>([
          ["password:hunter2", "value"],
          ["token=abc123", "value"],
        ]),
      }).inlineMap,
    ).toEqual({
      [REDACTED_LOG_KEY]: "[Redacted]",
      [`${REDACTED_LOG_KEY}2`]: "[Redacted]",
    });

    const internal = Symbol("ghp_symbol_secret");
    const symbolFields = {
      visible: "kept",
      [internal]: "should-not-log",
    };
    const sanitizedSymbolFields = sanitizeLogFields(symbolFields);

    expect(Object.keys(sanitizedSymbolFields)).toEqual(["visible"]);
    expect(sanitizedSymbolFields.visible).toBe("kept");
    expect(JSON.stringify(sanitizedSymbolFields)).not.toContain("should-not-log");

    const throwingToJson = {};

    Object.defineProperty(throwingToJson, "toJSON", {
      get() {
        throw new Error("hidden secret-token");
      },
    });

    expect(() => sanitizeLogFields({ values: [throwingToJson] })).not.toThrow();
    expect(JSON.stringify(sanitizeLogFields({ values: [throwingToJson] }))).not.toContain(
      "secret-token",
    );

    const circularToJson = {
      toJSON() {
        return circularToJson;
      },
    };

    expect(sanitizeLogFields({ circularToJson }).circularToJson).toBe("[Circular]");

    const protoFields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    protoFields["__proto__"] = "kept";
    expect(sanitizeLogFields(protoFields)["__proto__"]).toBe("kept");

    const longSafeKey = "safe".repeat(3_000);
    const sanitizedLongSafeKey = sanitizeLogFields({ [longSafeKey]: "kept" });

    expect(Object.hasOwn(sanitizedLongSafeKey, longSafeKey)).toBe(true);
    expect(sanitizedLongSafeKey[longSafeKey]).toBe("kept");

    const stream = new MemoryStream();
    const logger = createSurfaceLogger({ level: "info", stream });
    const hostileError = new Error("fallback");
    const protoError = new Error("proto");
    class StatusError extends Error {
      get code() {
        return "E_PROTO";
      }

      get statusCode() {
        return 503;
      }
    }

    Object.defineProperty(protoError, "__proto__", {
      configurable: true,
      enumerable: true,
      value: "kept",
    });

    Object.defineProperties(hostileError, {
      message: {
        configurable: true,
        get() {
          throw new Error("hidden bearer secret-token");
        },
      },
      stack: {
        configurable: true,
        get() {
          throw new Error("hidden stack secret-token");
        },
      },
    });

    const sanitizedProtoError = sanitizeLogFields({ err: protoError }).err as Record<
      string,
      unknown
    >;

    expect(Object.getPrototypeOf(sanitizedProtoError)).toBeNull();
    expect(Object.hasOwn(sanitizedProtoError, "__proto__")).toBe(true);
    expect(sanitizedProtoError["__proto__"]).toBe("kept");

    expect(sanitizeLogFields({ err: new StatusError("status") }).err).toMatchObject({
      code: "E_PROTO",
      statusCode: 503,
    });

    logger.error(hostileError);

    const parsed = JSON.parse(stream.lines.join("")) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      err: {
        name: "Error",
        message: "[Redacted]",
      },
    });
    expect(JSON.stringify(parsed)).not.toContain("secret-token");
  });

  it("sanitizes formatted error arguments and extra values", () => {
    const stream = new MemoryStream();
    const logger = createSurfaceLogger({ level: "info", stream });
    const hostileMap = new Map([
      [
        {
          toString() {
            throw new Error("hidden secret-token");
          },
        },
        "value",
      ],
    ]);

    Reflect.apply(Reflect.get(logger, "info"), logger, [
      "failed with %o and %o",
      new Error("bearer secret-token"),
      hostileMap,
      {
        htmlSnapshot: "<html>ignored</html>",
      },
    ]);
    logger.info("password=%s token=%s", "hunter2", "abc123");
    logger.info("password=hunter2 token=abc123 cookie=session authorization=Basic basicsecret");
    logger.info({ event: "x" }, "password=%s user=%s", "hunter2", "ada");
    logger.info("Authorization %s", "Basic basicsecret");
    logger.info({ event: "y" }, "Bearer %s", "bearertoken");
    logger.info("password=my multi word secret user=ada");
    logger.info("token=ghp_secret %s", "safe");
    logger.info('{"token":"abc123","password":"hunter2","ok":true}');

    const formattedLines = stream.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const formattedObjects = formattedLines[0] as Record<string, unknown>;
    const formattedSecrets = formattedLines[1] as Record<string, unknown>;
    const inlineSecrets = formattedLines[2] as Record<string, unknown>;
    const objectFirstSecrets = formattedLines[3] as Record<string, unknown>;
    const authorizationSecrets = formattedLines[4] as Record<string, unknown>;
    const bearerSecrets = formattedLines[5] as Record<string, unknown>;
    const multiWordSecrets = formattedLines[6] as Record<string, unknown>;
    const literalFormatSecrets = formattedLines[7] as Record<string, unknown>;
    const jsonStringSecrets = formattedLines[8] as Record<string, unknown>;

    expect(String(formattedObjects.msg)).toContain("[Redacted]");
    expect(JSON.stringify(formattedObjects)).not.toContain("secret-token");
    expect(JSON.stringify(formattedObjects)).not.toContain("ignored");
    expect(String(formattedSecrets.msg)).toContain("[Redacted]");
    expect(JSON.stringify(formattedSecrets)).not.toContain("hunter2");
    expect(JSON.stringify(formattedSecrets)).not.toContain("abc123");
    expect(String(inlineSecrets.msg)).toContain("password=[Redacted]");
    expect(String(inlineSecrets.msg)).toContain("token=[Redacted]");
    expect(String(inlineSecrets.msg)).toContain("cookie=[Redacted]");
    expect(String(inlineSecrets.msg)).toContain("authorization=[Redacted]");
    expect(JSON.stringify(inlineSecrets)).not.toContain("hunter2");
    expect(JSON.stringify(inlineSecrets)).not.toContain("abc123");
    expect(JSON.stringify(inlineSecrets)).not.toContain("basicsecret");
    expect(String(objectFirstSecrets.msg)).toContain("[Redacted]");
    expect(JSON.stringify(objectFirstSecrets)).not.toContain("hunter2");
    expect(String(authorizationSecrets.msg)).toContain("[Redacted]");
    expect(JSON.stringify(authorizationSecrets)).not.toContain("basicsecret");
    expect(String(bearerSecrets.msg)).toContain("[Redacted]");
    expect(JSON.stringify(bearerSecrets)).not.toContain("bearertoken");
    expect(String(multiWordSecrets.msg)).toContain("password=[Redacted]");
    expect(String(multiWordSecrets.msg)).toContain("user=ada");
    expect(JSON.stringify(multiWordSecrets)).not.toContain("multi word secret");
    expect(String(literalFormatSecrets.msg)).toContain("token=[Redacted] [Redacted]");
    expect(JSON.stringify(literalFormatSecrets)).not.toContain("ghp_secret");
    expect(String(jsonStringSecrets.msg)).toContain('"token":[Redacted]');
    expect(String(jsonStringSecrets.msg)).toContain('"password":[Redacted]');
    expect(JSON.stringify(jsonStringSecrets)).not.toContain("abc123");
    expect(JSON.stringify(jsonStringSecrets)).not.toContain("hunter2");
  });

  it("applies the depth limit before nested collection traversal", () => {
    let nested: unknown = "leaf";

    for (let depth = 0; depth < 30; depth += 1) {
      nested = new Map([["next", nested]]);
    }

    let cursor = sanitizeLogFields({ nested }).nested;
    let traversed = 0;

    while (cursor !== null && typeof cursor === "object" && Object.hasOwn(cursor, "next")) {
      traversed += 1;
      cursor = (cursor as Record<string, unknown>).next;
    }

    expect(traversed).toBe(25);
    expect(cursor).toBe("[Redacted]");

    const wideArray = Array.from({ length: 1_002 }, (_value, index) => `item-${index}`);
    const wideObject = Object.fromEntries(
      Array.from({ length: 1_002 }, (_value, index) => [`key-${index}`, index]),
    );
    const sanitizedWide = sanitizeLogFields({
      wideArray,
      wideMap: new Map(wideArray.map((value, index) => [`key-${index}`, value])),
      wideObject,
    });

    expect(sanitizedWide.wideArray).toHaveLength(1_001);
    expect((sanitizedWide.wideArray as unknown[]).at(-1)).toBe("[Truncated]");
    expect(Object.keys(sanitizedWide.wideMap as Record<string, unknown>)).toHaveLength(1_001);
    expect((sanitizedWide.wideMap as Record<string, unknown>)["[Truncated]"]).toBe("[Truncated]");
    expect(Object.keys(sanitizedWide.wideObject as Record<string, unknown>)).toHaveLength(1_001);
    expect((sanitizedWide.wideObject as Record<string, unknown>)["[Truncated]"]).toBe(
      "[Truncated]",
    );
  });
});
