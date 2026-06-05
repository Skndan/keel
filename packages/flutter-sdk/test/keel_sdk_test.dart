import 'package:flutter_test/flutter_test.dart';
import 'package:keel_sdk/keel_sdk.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

void main() {
  group('KeelClient', () {
    late KeelClient client;

    setUp(() {
      client = KeelClient(
        baseUrl: 'https://keel.example.com/v1',
        projectSlug: 'my-app',
        apiKey: 'keel_my-app_abc123',
      );
    });

    test('constructor sets properties', () {
      expect(client.baseUrl, 'https://keel.example.com/v1');
      expect(client.projectSlug, 'my-app');
      expect(client.accessToken, isNull);
    });

    test('setTokens updates access and refresh tokens', () {
      client.setTokens(
        accessToken: 'jwt-access',
        refreshToken: 'jwt-refresh',
      );
      expect(client.accessToken, 'jwt-access');
      expect(client.refreshToken, 'jwt-refresh');
    });

    test('clearTokens removes all tokens', () {
      client.setTokens(
        accessToken: 'jwt-access',
        refreshToken: 'jwt-refresh',
      );
      client.clearTokens();
      expect(client.accessToken, isNull);
      expect(client.refreshToken, isNull);
    });

    test('buildGoogleOAuthUrl returns correct URL', () {
      final url = client.buildGoogleOAuthUrl('my-app');
      expect(url, 'https://keel.example.com/v1/project/my-app/auth/google');
    });

    test('buildGithubOAuthUrl returns correct URL', () {
      final url = client.buildGithubOAuthUrl('my-app');
      expect(url, 'https://keel.example.com/v1/project/my-app/auth/github');
    });
  });

  group('KeelException', () {
    test('toString formats correctly', () {
      final ex = KeelException(
        code: 'NOT_FOUND',
        message: 'Project not found',
        statusCode: 404,
      );
      expect(ex.code, 'NOT_FOUND');
      expect(ex.message, 'Project not found');
      expect(ex.statusCode, 404);
      expect(ex.toString(), contains('NOT_FOUND'));
    });
  });

  group('KeelPKCE', () {
    test('generate creates valid verifier and challenge', () {
      final pkce = KeelPKCE.generate();

      expect(pkce.codeVerifier.length, greaterThanOrEqualTo(43));
      expect(pkce.codeVerifier.length, lessThanOrEqualTo(128));
      // Challenge should be base64url
      expect(pkce.codeChallenge, isNotEmpty);
      expect(pkce.codeChallenge, isNot(contains('=')));
    });

    test('generate produces different values each time', () {
      final pkce1 = KeelPKCE.generate();
      final pkce2 = KeelPKCE.generate();
      expect(pkce1.codeVerifier, isNot(equals(pkce2.codeVerifier)));
      expect(pkce1.codeChallenge, isNot(equals(pkce2.codeChallenge)));
    });
  });

  group('KeelOAuth', () {
    test('buildGoogleAuthUri creates valid URI', () {
      final pkce = KeelPKCE.generate();
      final uri = KeelOAuth.buildGoogleAuthUri(
        baseUrl: 'https://keel.example.com/v1',
        projectSlug: 'my-app',
        pkce: pkce,
      );

      expect(uri.scheme, 'https');
      expect(uri.path, '/v1/project/my-app/auth/google');
      expect(uri.queryParameters['code_challenge'], pkce.codeChallenge);
      expect(uri.queryParameters['code_challenge_method'], 'S256');
    });

    test('buildGithubAuthUri creates valid URI', () {
      final pkce = KeelPKCE.generate();
      final uri = KeelOAuth.buildGithubAuthUri(
        baseUrl: 'https://keel.example.com/v1',
        projectSlug: 'my-app',
        pkce: pkce,
      );

      expect(uri.path, '/v1/project/my-app/auth/github');
      expect(uri.queryParameters['code_verifier'], pkce.codeVerifier);
    });

    test('parseCodeFromCallbackUri extracts code', () {
      final uri = Uri.parse('https://example.com/callback?code=abc123&state=xyz');
      expect(KeelOAuth.parseCodeFromCallbackUri(uri), 'abc123');
    });

    test('parseErrorFromCallbackUri extracts error', () {
      final uri = Uri.parse('https://example.com/callback?error=access_denied');
      expect(KeelOAuth.parseErrorFromCallbackUri(uri), 'access_denied');
    });

    test('parseCodeFromCallbackUri returns null when no code', () {
      final uri = Uri.parse('https://example.com/callback');
      expect(KeelOAuth.parseCodeFromCallbackUri(uri), isNull);
    });
  });

  group('KeelStorage', () {
    test('getPublicUrl builds correct URL', () {
      final url = KeelStorage.getPublicUrl(
        'https://pub-abc.r2.dev',
        'my-app/photos/cat.jpg',
      );
      expect(url, 'https://pub-abc.r2.dev/my-app/photos/cat.jpg');
    });

    test('getPublicUrl removes trailing slash', () {
      final url = KeelStorage.getPublicUrl(
        'https://pub-abc.r2.dev/',
        'my-app/file.txt',
      );
      expect(url, 'https://pub-abc.r2.dev/my-app/file.txt');
    });
  });
}
