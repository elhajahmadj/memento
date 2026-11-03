import fs from "node:fs/promises";
import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import type { ApiScaffoldResult } from "@/features/projects/infrastructure/apiCsharpScaffolder";

export const JAVA_API_HELPER_MODULE_SUFFIX = "-automation-api";
export const JAVA_API_TESTS_MODULE_SUFFIX = "-automation-api-tests";

/**
 * Lower-case alnum segment of a solution name suitable as a Java
 * package piece. Inlined here (instead of importing from
 * `projectService`) to avoid an import cycle: `projectService` already
 * imports from the api scaffolder registry.
 */
export function javaApiPackageSegment(solutionName: string): string {
  const cleaned = solutionName.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  if (cleaned.length === 0) return "pkg";
  if (/^[0-9]/.test(cleaned)) return `pkg${cleaned}`;
  return cleaned;
}

export function javaApiHelperModule(solutionName: string): string {
  return `${solutionName}${JAVA_API_HELPER_MODULE_SUFFIX}`;
}

export function javaApiTestsModule(solutionName: string): string {
  return `${solutionName}${JAVA_API_TESTS_MODULE_SUFFIX}`;
}

export function javaApiBasePackage(solutionName: string): string {
  return `com.${javaApiPackageSegment(solutionName)}.automation.api`;
}

function rootPom(solutionName: string): string {
  const pkg = javaApiPackageSegment(solutionName);
  const helper = javaApiHelperModule(solutionName);
  const tests = javaApiTestsModule(solutionName);
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.${pkg}</groupId>
    <artifactId>${solutionName}</artifactId>
    <version>0.1.0</version>
    <packaging>pom</packaging>
    <modules>
        <module>${helper}</module>
        <module>${tests}</module>
    </modules>
    <properties>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <jackson.version>2.17.2</jackson.version>
        <junit.version>5.11.0</junit.version>
        <assertj.version>3.26.3</assertj.version>
        <surefire.version>3.2.5</surefire.version>
    </properties>
    <build>
        <pluginManagement>
            <plugins>
                <plugin>
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-surefire-plugin</artifactId>
                    <version>\${surefire.version}</version>
                </plugin>
            </plugins>
        </pluginManagement>
    </build>
</project>
`;
}

function helperPom(solutionName: string): string {
  const pkg = javaApiPackageSegment(solutionName);
  const helper = javaApiHelperModule(solutionName);
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>com.${pkg}</groupId>
        <artifactId>${solutionName}</artifactId>
        <version>0.1.0</version>
    </parent>
    <artifactId>${helper}</artifactId>
    <dependencies>
        <dependency>
            <groupId>com.fasterxml.jackson.core</groupId>
            <artifactId>jackson-databind</artifactId>
            <version>\${jackson.version}</version>
        </dependency>
    </dependencies>
</project>
`;
}

function testsPom(solutionName: string): string {
  const pkg = javaApiPackageSegment(solutionName);
  const helper = javaApiHelperModule(solutionName);
  const tests = javaApiTestsModule(solutionName);
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>com.${pkg}</groupId>
        <artifactId>${solutionName}</artifactId>
        <version>0.1.0</version>
    </parent>
    <artifactId>${tests}</artifactId>
    <dependencies>
        <dependency>
            <groupId>com.${pkg}</groupId>
            <artifactId>${helper}</artifactId>
            <version>0.1.0</version>
        </dependency>
        <dependency>
            <groupId>org.junit.jupiter</groupId>
            <artifactId>junit-jupiter</artifactId>
            <version>\${junit.version}</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.assertj</groupId>
            <artifactId>assertj-core</artifactId>
            <version>\${assertj.version}</version>
            <scope>test</scope>
        </dependency>
    </dependencies>
    <build>
        <testResources>
            <testResource>
                <directory>src/test/resources</directory>
            </testResource>
        </testResources>
    </build>
</project>
`;
}

export function apiEndpointsJava(basePkg: string): string {
  return `package ${basePkg}.constants;

/**
 * Endpoint route constants for API tests. Build Test → AssistantBuilder
 * appends new entries (or nested classes) here atomically.
 */
public final class ApiEndpoints {
    private ApiEndpoints() {
    }
}
`;
}

function testCollectionsJava(basePkg: string): string {
  return `package ${basePkg}.constants;

/**
 * Canonical JUnit 5 tag name. Generated test classes reference
 * {@link #API} via {@code @Tag(TestCollections.API)}.
 */
public final class TestCollections {
    public static final String API = "API";

    private TestCollections() {
    }
}
`;
}

function apiTestOptionsJava(basePkg: string): string {
  return `package ${basePkg}.infrastructure;

/**
 * Strongly-typed bindings for a per-environment URL block in
 * {@code appsettings.json} under {@code ApiTest.Urls.{urlName}}.
 */
public final class ApiTestOptions {
    public final String baseUrl;

    public ApiTestOptions(String baseUrl) {
        this.baseUrl = baseUrl;
    }
}
`;
}

function apiTestFixtureJava(basePkg: string): string {
  return `package ${basePkg}.infrastructure;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.InputStream;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Shared API test fixture. Singleton-scoped so every JUnit 5 test class
 * tagged with {@code @Tag(TestCollections.API)} reuses the same
 * {@link HttpClient} per URL name. URL blocks live under
 * {@code ApiTest.Urls.{urlName}} in {@code appsettings.json} on the
 * test classpath.
 */
public final class ApiTestFixture {
    private static final ApiTestFixture INSTANCE = new ApiTestFixture();

    private final ConcurrentHashMap<String, HttpClient> clients = new ConcurrentHashMap<>();
    private final JsonNode root;

    private ApiTestFixture() {
        try (InputStream in = getClass().getClassLoader().getResourceAsStream("appsettings.json")) {
            if (in == null) {
                throw new IllegalStateException("appsettings.json missing from test classpath");
            }
            this.root = new ObjectMapper().readTree(in);
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("Failed to load appsettings.json", e);
        }
    }

    public static ApiTestFixture getInstance() {
        return INSTANCE;
    }

    public JsonNode getConfiguration() {
        return root;
    }

    public ApiTestOptions getOptions(String urlName) {
        JsonNode urlBlock = root.path("ApiTest").path("Urls").path(urlName);
        String baseUrl = urlBlock.path("BaseUrl").asText("");
        if (baseUrl.isEmpty()) {
            throw new IllegalStateException(
                "appsettings.json is missing ApiTest.Urls." + urlName + ".BaseUrl");
        }
        return new ApiTestOptions(baseUrl);
    }

    public HttpClient getClient(String urlName) {
        // Resolve options eagerly so missing config fails fast on first use.
        getOptions(urlName);
        return clients.computeIfAbsent(urlName, name -> HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(30))
            .build());
    }
}
`;
}

function retryInterceptorJava(basePkg: string): string {
  return `package ${basePkg}.handlers;

import java.io.IOException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandler;

/**
 * Retries transient HTTP failures (5xx + 408 + 429) with exponential
 * backoff. Java's {@link HttpClient} has no interceptor surface, so
 * generated helpers route their {@code send} call through
 * {@link #send(HttpClient, HttpRequest, BodyHandler)}.
 */
public final class RetryInterceptor {
    private final int maxRetries;
    private final long baseDelayMs;

    public RetryInterceptor() {
        this(3, 200L);
    }

    public RetryInterceptor(int maxRetries, long baseDelayMs) {
        this.maxRetries = maxRetries;
        this.baseDelayMs = baseDelayMs;
    }

    public <T> HttpResponse<T> send(HttpClient client, HttpRequest request, BodyHandler<T> handler)
            throws IOException, InterruptedException {
        HttpResponse<T> response = null;
        for (int attempt = 0; ; attempt++) {
            response = client.send(request, handler);
            if (attempt >= maxRetries || !shouldRetry(response.statusCode())) {
                return response;
            }
            long delay = (long) (baseDelayMs * Math.pow(2, attempt));
            Thread.sleep(delay);
        }
    }

    private static boolean shouldRetry(int code) {
        return code >= 500 || code == 408 || code == 429;
    }
}
`;
}

function httpLoggingInterceptorJava(basePkg: string): string {
  return `package ${basePkg}.handlers;

import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

/**
 * Mirrors every request/response line to {@code System.out} so test
 * runners (Surefire, IDE) capture per-test transport activity.
 */
public final class HttpLoggingInterceptor {
    private HttpLoggingInterceptor() {
    }

    public static void logRequest(HttpRequest request) {
        System.out.println("[HTTP] -> " + request.method() + " " + request.uri());
    }

    public static <T> void logResponse(HttpRequest request, HttpResponse<T> response, long elapsedMs) {
        System.out.println("[HTTP] <- " + response.statusCode() + " "
            + request.method() + " " + request.uri() + " (" + elapsedMs + "ms)");
    }
}
`;
}

function configurationExtensionsJava(basePkg: string): string {
  return `package ${basePkg}.extensions;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Configuration helpers for API tests. {@link #getAccessToken} is a
 * mock by default — production deployments are expected to replace its
 * body with a real token-mint call before running authenticated tests.
 */
public final class ConfigurationExtensions {
    private ConfigurationExtensions() {
    }

    public static String getAccessToken(JsonNode config, String urlName) {
        JsonNode token = config.path("ApiTest").path("Urls").path(urlName).path("AccessToken");
        if (token.isMissingNode() || !token.isTextual() || token.asText().isEmpty()) {
            return "mock-access-token";
        }
        return token.asText();
    }
}
`;
}

function apiTestCollectionJava(basePkg: string): string {
  return `package ${basePkg}.tests.infrastructure;

import org.junit.jupiter.api.Tag;
import ${basePkg}.constants.TestCollections;

/**
 * Marker base class. Generated test classes use {@code @Tag(TestCollections.API)}
 * directly — this type is provided for parity with the C# scaffold's
 * collection-fixture pattern and as a convenient extension point for
 * shared {@code @BeforeAll} / {@code @AfterAll} lifecycle hooks.
 */
@Tag(TestCollections.API)
public class ApiTestCollection {
}
`;
}

function appsettingsJson(): string {
  return `${JSON.stringify({ ApiTest: { Urls: {} } }, null, 2)}\n`;
}

/**
 * Scaffold a brand-new Java + JUnit 5 + AssertJ + java.net.http.HttpClient
 * API test solution. Layout (mirrors {@code apiCsharpScaffolder.ts}):
 *
 *   {sln}/                                  ← rootPath
 *     pom.xml                               ← parent POM (slnPath)
 *     .testbuilder.json                     ← solutionType: "api"
 *     {sln}-automation-api/
 *       pom.xml
 *       src/main/java/com/{pkg}/automation/api/
 *         constants/ApiEndpoints.java
 *         constants/TestCollections.java
 *         infrastructure/ApiTestFixture.java
 *         infrastructure/ApiTestOptions.java
 *         handlers/RetryInterceptor.java
 *         handlers/HttpLoggingInterceptor.java
 *         extensions/ConfigurationExtensions.java
 *     {sln}-automation-api-tests/
 *       pom.xml
 *       src/test/resources/appsettings.json
 *       src/test/java/com/{pkg}/automation/api/tests/
 *         infrastructure/ApiTestCollection.java
 *         apitestingassistants/             ← one assistant class per suite
 *         tests/                            ← test classes land here
 */
export async function scaffoldApiJava(
  solutionName: string,
  _namespace: string,
): Promise<ApiScaffoldResult> {
  await fs.mkdir(recorderConfig.workspaceDir, { recursive: true });
  const rootPath = path.join(recorderConfig.workspaceDir, solutionName);
  await fs.mkdir(rootPath, { recursive: true });

  const helperModuleName = javaApiHelperModule(solutionName);
  const testsModuleName = javaApiTestsModule(solutionName);
  const basePkg = javaApiBasePackage(solutionName);
  const pkgPath = basePkg.replace(/\./g, "/");

  const helperDir = safeJoin(rootPath, helperModuleName);
  const testsDir = safeJoin(rootPath, testsModuleName);
  await fs.mkdir(helperDir, { recursive: true });
  await fs.mkdir(testsDir, { recursive: true });

  // --- root parent pom ---
  const slnPath = path.join(rootPath, "pom.xml");
  await fs.writeFile(slnPath, rootPom(solutionName));

  // --- helper module ---
  await fs.writeFile(safeJoin(helperDir, "pom.xml"), helperPom(solutionName));
  const helperJavaRoot = safeJoin(helperDir, `src/main/java/${pkgPath}`);
  await fs.mkdir(safeJoin(helperJavaRoot, "constants"), { recursive: true });
  await fs.mkdir(safeJoin(helperJavaRoot, "infrastructure"), { recursive: true });
  await fs.mkdir(safeJoin(helperJavaRoot, "handlers"), { recursive: true });
  await fs.mkdir(safeJoin(helperJavaRoot, "extensions"), { recursive: true });

  await fs.writeFile(
    safeJoin(helperJavaRoot, "constants/ApiEndpoints.java"),
    apiEndpointsJava(basePkg),
  );
  await fs.writeFile(
    safeJoin(helperJavaRoot, "constants/TestCollections.java"),
    testCollectionsJava(basePkg),
  );
  await fs.writeFile(
    safeJoin(helperJavaRoot, "infrastructure/ApiTestFixture.java"),
    apiTestFixtureJava(basePkg),
  );
  await fs.writeFile(
    safeJoin(helperJavaRoot, "infrastructure/ApiTestOptions.java"),
    apiTestOptionsJava(basePkg),
  );
  await fs.writeFile(
    safeJoin(helperJavaRoot, "handlers/RetryInterceptor.java"),
    retryInterceptorJava(basePkg),
  );
  await fs.writeFile(
    safeJoin(helperJavaRoot, "handlers/HttpLoggingInterceptor.java"),
    httpLoggingInterceptorJava(basePkg),
  );
  await fs.writeFile(
    safeJoin(helperJavaRoot, "extensions/ConfigurationExtensions.java"),
    configurationExtensionsJava(basePkg),
  );

  // --- tests module ---
  await fs.writeFile(safeJoin(testsDir, "pom.xml"), testsPom(solutionName));
  await fs.mkdir(safeJoin(testsDir, "src/test/resources"), { recursive: true });
  await fs.writeFile(
    safeJoin(testsDir, "src/test/resources/appsettings.json"),
    appsettingsJson(),
  );
  const testsJavaRoot = safeJoin(testsDir, `src/test/java/${pkgPath}/tests`);
  await fs.mkdir(safeJoin(testsJavaRoot, "infrastructure"), { recursive: true });
  await fs.mkdir(safeJoin(testsJavaRoot, "apitestingassistants"), {
    recursive: true,
  });
  await fs.mkdir(safeJoin(testsJavaRoot, "tests"), { recursive: true });
  await fs.writeFile(safeJoin(testsJavaRoot, "tests/.gitkeep"), "");
  await fs.writeFile(
    safeJoin(testsJavaRoot, "apitestingassistants/.gitkeep"),
    "",
  );
  // Per-suite recorded `<Suite>Constants.java` and `<Suite>TestCategories.java`
  // are written here when the recorder fills them in. Empty `.gitkeep` files
  // keep the directories present in fresh scaffolds (mirrors the UI Java
  // architecture's `constants/` and `testcategories/` siblings of `tests/`).
  await fs.mkdir(safeJoin(testsJavaRoot, "constants"), { recursive: true });
  await fs.writeFile(safeJoin(testsJavaRoot, "constants/.gitkeep"), "");
  await fs.mkdir(safeJoin(testsJavaRoot, "testcategories"), {
    recursive: true,
  });
  await fs.writeFile(
    safeJoin(testsJavaRoot, "testcategories/.gitkeep"),
    "",
  );
  await fs.writeFile(
    safeJoin(testsJavaRoot, "infrastructure/ApiTestCollection.java"),
    apiTestCollectionJava(basePkg),
  );

  return {
    rootPath,
    slnPath,
    helperProjectName: helperModuleName,
    testProjectName: testsModuleName,
  };
}
