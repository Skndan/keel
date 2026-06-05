import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';

/// PKCE (Proof Key for Code Exchange) utilities for OAuth 2.0 flows.
///
/// Used by the Flutter SDK to implement secure OAuth authentication
/// for end users of a Keel project.
///
/// Usage:
/// ```dart
/// // Generate PKCE challenge
/// final pkce = KeelPKCE.generate();
///
/// // Build OAuth URL with PKCE params
/// final url = '$baseUrl/project/$slug/auth/google?'
///   'code_challenge=${pkce.codeChallenge}'
///   '&code_challenge_method=S256';
///
/// // After callback, exchange code for tokens
/// final tokens = await client.exchangeCode(
///   slug: 'my-app',
///   code: receivedCode,
///   codeVerifier: pkce.codeVerifier,
/// );
/// ```
class KeelPKCE {
  final String codeVerifier;
  final String codeChallenge;

  KeelPKCE._({
    required this.codeVerifier,
    required this.codeChallenge,
  });

  /// Generate a new PKCE code verifier and challenge pair.
  ///
  /// Uses S256 method (SHA-256) as recommended by the OAuth 2.0 spec.
  factory KeelPKCE.generate() {
    final verifier = _generateCodeVerifier();
    final challenge = _generateCodeChallenge(verifier);
    return KeelPKCE._(codeVerifier: verifier, codeChallenge: challenge);
  }

  /// Generate a cryptographically random code verifier (43-128 chars).
  static String _generateCodeVerifier() {
    final random = Random.secure();
    final bytes = List<int>.generate(32, (_) => random.nextInt(256));
    return base64Url.encode(bytes).replaceAll('=', '');
  }

  /// Generate a code challenge from a verifier using SHA-256.
  static String _generateCodeChallenge(String verifier) {
    final bytes = utf8.encode(verifier);
    final digest = sha256.convert(bytes);
    return base64Url.encode(digest.bytes).replaceAll('=', '');
  }

  @override
  String toString() => 'KeelPKCE(verifier=${codeVerifier.substring(0, 8)}..., challenge=$codeChallenge)';
}

/// Keel OAuth helper — handles project-scoped OAuth flows.
class KeelOAuth {
  /// Build a Google OAuth URL with PKCE for a given project.
  ///
  /// [baseUrl] — Keel gateway base URL (e.g. https://my-keel.example.com/v1)
  /// [projectSlug] — the project slug
  /// [pkce] — PKCE challenge (generated via KeelPKCE.generate())
  static Uri buildGoogleAuthUri({
    required String baseUrl,
    required String projectSlug,
    required KeelPKCE pkce,
  }) {
    return Uri.parse(
      '$baseUrl/project/$projectSlug/auth/google'
      '?code_challenge=${Uri.encodeComponent(pkce.codeChallenge)}'
      '&code_challenge_method=S256',
    );
  }

  /// Build a GitHub OAuth URL for a given project.
  ///
  /// GitHub uses a state parameter (no PKCE), but we still generate a
  /// verifier for consistency. The gateway handles state internally.
  static Uri buildGithubAuthUri({
    required String baseUrl,
    required String projectSlug,
    required KeelPKCE pkce,
  }) {
    return Uri.parse(
      '$baseUrl/project/$projectSlug/auth/github'
      '?code_verifier=${Uri.encodeComponent(pkce.codeVerifier)}',
    );
  }

  /// Parse the OAuth callback URL to extract the authorization code.
  ///
  /// Returns null if the URL doesn't contain a code parameter.
  static String? parseCodeFromCallbackUri(Uri callbackUri) {
    return callbackUri.queryParameters['code'];
  }

  /// Parse the OAuth callback URL to check for errors.
  ///
  /// Returns the error description if present, null otherwise.
  static String? parseErrorFromCallbackUri(Uri callbackUri) {
    return callbackUri.queryParameters['error'];
  }
}
