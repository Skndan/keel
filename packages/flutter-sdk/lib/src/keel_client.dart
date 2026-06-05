import 'dart:convert';
import 'package:http/http.dart' as http;

/// Main Keel client for interacting with the Gateway API.
class KeelClient {
  final String baseUrl;
  final String? _apiKey;
  String? _accessToken;

  KeelClient({
    required this.baseUrl,
    String? apiKey,
    String? accessToken,
  })  : _apiKey = apiKey,
        _accessToken = accessToken;

  /// Set the JWT access token (after OAuth login).
  void setAccessToken(String token) => _accessToken = token;

  // ─── Auth ─────────────────────────────────────────────

  /// Get the current authenticated user.
  Future<Map<String, dynamic>> getMe() async {
    return _get('/v1/auth/me');
  }

  // ─── Projects ─────────────────────────────────────────

  /// List all projects for the authenticated account.
  Future<List<Map<String, dynamic>>> listProjects() async {
    final res = await _get('/v1/projects');
    return List<Map<String, dynamic>>.from(res['data'] ?? []);
  }

  /// Create a new project.
  Future<Map<String, dynamic>> createProject(String name) async {
    return _post('/v1/projects', {'name': name});
  }

  /// Delete a project by slug.
  Future<void> deleteProject(String slug) async {
    await _delete('/v1/projects/$slug');
  }

  // ─── Database Query ───────────────────────────────────

  /// Run a parameterized SQL query on a project database.
  Future<Map<String, dynamic>> query(
    String slug, {
    required String query,
    List<dynamic> params = const [],
  }) async {
    return _post('/v1/project/$slug/db/query', {
      'query': query,
      'params': params,
    });
  }

  // ─── Storage ──────────────────────────────────────────

  /// Get a presigned upload URL for a file.
  Future<Map<String, dynamic>> getUploadUrl(
    String slug, {
    required String filename,
    String? contentType,
  }) async {
    return _post('/v1/project/$slug/storage/upload-url', {
      'filename': filename,
      'content_type': contentType,
    });
  }

  /// Get a presigned download URL for a file.
  Future<Map<String, dynamic>> getDownloadUrl(
    String slug, {
    required String key,
  }) async {
    return _get('/v1/project/$slug/storage/download-url?key=$key');
  }

  // ─── HTTP helpers ─────────────────────────────────────

  Future<Map<String, dynamic>> _get(String path) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = _buildHeaders();
    final res = await http.get(uri, headers: headers);
    return _handleResponse(res);
  }

  Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = _buildHeaders()..['Content-Type'] = 'application/json';
    final res = await http.post(uri, headers: headers, body: jsonEncode(body));
    return _handleResponse(res);
  }

  Future<Map<String, dynamic>> _delete(String path) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = _buildHeaders();
    final res = await http.delete(uri, headers: headers);
    if (res.statusCode == 204) return {};
    return _handleResponse(res);
  }

  Map<String, String> _buildHeaders() {
    final headers = <String, String>{};
    if (_accessToken != null) {
      headers['Authorization'] = 'Bearer $_accessToken';
    }
    return headers;
  }

  Map<String, dynamic> _handleResponse(http.Response res) {
    final body = jsonDecode(res.body) as Map<String, dynamic>;

    if (res.statusCode >= 400) {
      final error = body['error'];
      throw KeelException(
        code: error?['code'] ?? 'UNKNOWN',
        message: error?['message'] ?? 'Request failed',
        statusCode: res.statusCode,
      );
    }

    return body;
  }
}

class KeelException implements Exception {
  final String code;
  final String message;
  final int statusCode;

  KeelException({
    required this.code,
    required this.message,
    required this.statusCode,
  });

  @override
  String toString() => 'KeelException($statusCode): [$code] $message';
}
