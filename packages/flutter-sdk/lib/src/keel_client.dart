import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:dio/dio.dart';

/// Main Keel client for interacting with the Gateway API.
///
/// Project-scoped usage (end-user or admin):
/// ```dart
/// final client = KeelClient(
///   baseUrl: 'https://my-keel.example.com/v1',
///   projectSlug: 'my-app',
///   apiKey: 'keel_my-app_abc123...',
/// );
/// ```
///
/// Admin dashboard usage:
/// ```dart
/// final client = KeelClient(
///   baseUrl: 'https://my-keel.example.com/v1',
///   accessToken: 'jwt-token-from-login',
/// );
/// ```
class KeelClient {
  final String baseUrl;
  final String? projectSlug;
  final String? _apiKey;
  String? _accessToken;
  String? _refreshToken;
  late final Dio _dio;
  Function(String accessToken, String refreshToken)? onTokenRefreshed;

  KeelClient({
    required this.baseUrl,
    this.projectSlug,
    String? apiKey,
    String? accessToken,
    String? refreshToken,
    this.onTokenRefreshed,
  })  : _apiKey = apiKey,
        _accessToken = accessToken,
        _refreshToken = refreshToken {
    _dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
    ));

    // Add interceptor for JWT auto-refresh
    _dio.interceptors.add(_KeelAuthInterceptor(this));
  }

  /// Set the JWT tokens (after OAuth login or manual auth).
  void setTokens({
    required String accessToken,
    String? refreshToken,
  }) {
    _accessToken = accessToken;
    if (refreshToken != null) _refreshToken = refreshToken;
  }

  /// Clear all tokens (logout).
  void clearTokens() {
    _accessToken = null;
    _refreshToken = null;
  }

  String? get accessToken => _accessToken;
  String? get refreshToken => _refreshToken;

  // ─── Auth (dashboard-level) ──────────────────────────

  /// Login with admin email/password (dashboard access only).
  Future<Map<String, dynamic>> login(String email, String password) async {
    final res = await _post('/auth/login', {
      'email': email,
      'password': password,
    });
    final data = res['data'];
    setTokens(
      accessToken: data['access_token'],
      refreshToken: data['refresh_token'],
    );
    return data;
  }

  /// Refresh the access token.
  Future<void> refreshAccessToken() async {
    if (_refreshToken == null) {
      throw KeelException(code: 'NO_REFRESH_TOKEN', message: 'No refresh token available', statusCode: 401);
    }

    final res = await _post('/auth/refresh', {
      'refresh_token': _refreshToken,
    });

    final data = res['data'];
    _accessToken = data['access_token'];
    _refreshToken = data['refresh_token'];

    onTokenRefreshed?.call(_accessToken!, _refreshToken!);
  }

  /// Get the current authenticated user (dashboard-level).
  Future<Map<String, dynamic>> getMe() async {
    return _get('/auth/me');
  }

  // ─── Projects (dashboard-level) ───────────────────────

  /// List all projects for the authenticated account.
  Future<List<Map<String, dynamic>>> listProjects() async {
    final res = await _get('/projects');
    return List<Map<String, dynamic>>.from(res['data'] ?? []);
  }

  /// Create a new project (with optional OAuth + R2 configs).
  Future<Map<String, dynamic>> createProject(
    String name, {
    String? googleClientId,
    String? googleClientSecret,
    String? githubClientId,
    String? githubClientSecret,
    String? r2AccessKeyId,
    String? r2SecretAccessKey,
    String? r2Bucket,
    String? r2Endpoint,
  }) async {
    final body = <String, dynamic>{'name': name};
    if (googleClientId != null) body['google_client_id'] = googleClientId;
    if (googleClientSecret != null) body['google_client_secret'] = googleClientSecret;
    if (githubClientId != null) body['github_client_id'] = githubClientId;
    if (githubClientSecret != null) body['github_client_secret'] = githubClientSecret;
    if (r2AccessKeyId != null) body['r2_access_key_id'] = r2AccessKeyId;
    if (r2SecretAccessKey != null) body['r2_secret_access_key'] = r2SecretAccessKey;
    if (r2Bucket != null) body['r2_bucket'] = r2Bucket;
    if (r2Endpoint != null) body['r2_endpoint'] = r2Endpoint;

    return _post('/projects', body);
  }

  /// Delete a project by slug.
  Future<void> deleteProject(String slug) async {
    await _delete('/projects/$slug');
  }

  /// Get project details.
  Future<Map<String, dynamic>> getProject(String slug) async {
    return _get('/projects/$slug');
  }

  // ─── Database Query ───────────────────────────────────

  /// Run a parameterized SQL query on a project database.
  ///
  /// Uses [projectSlug] from constructor if not provided.
  Future<Map<String, dynamic>> query(
    String query, {
    List<dynamic> params = const [],
    String? slug,
  }) async {
    final projectSlug = slug ?? this.projectSlug;
    if (projectSlug == null) {
      throw KeelException(
        code: 'NO_PROJECT',
        message: 'projectSlug is required — pass it or set in constructor',
        statusCode: 400,
      );
    }
    return _post('/project/$projectSlug/db/query', {
      'query': query,
      'params': params,
    });
  }

  /// Run a SELECT query and return typed results.
  Future<List<Map<String, dynamic>>> select(
    String table, {
    List<String> columns = const ['*'],
    String? where,
    List<dynamic>? whereParams,
    String? orderBy,
    int? limit,
    int? offset,
    String? slug,
  }) async {
    final parts = <String>[];
    parts.add('SELECT ${columns.join(', ')} FROM "$table"');

    if (where != null) {
      parts.add('WHERE $where');
    }
    if (orderBy != null) {
      parts.add('ORDER BY $orderBy');
    }
    if (limit != null) {
      parts.add('LIMIT $limit');
    }
    if (offset != null) {
      parts.add('OFFSET $offset');
    }

    final res = await query(
      parts.join(' '),
      params: whereParams ?? [],
      slug: slug,
    );
    return List<Map<String, dynamic>>.from(res['data']['rows'] ?? []);
  }

  /// Insert a row into a table.
  Future<Map<String, dynamic>> insert(
    String table,
    Map<String, dynamic> values, {
    String? slug,
  }) async {
    final cols = values.keys.map((k) => '"$k"').join(', ');
    final placeholders = values.keys.map((_) => '?').join(', ');
    return query(
      'INSERT INTO "$table" ($cols) VALUES ($placeholders)',
      params: values.values.toList(),
      slug: slug,
    );
  }

  /// Update rows in a table.
  Future<Map<String, dynamic>> update(
    String table,
    Map<String, dynamic> values,
    String where,
    List<dynamic> whereParams, {
    String? slug,
  }) async {
    final sets = values.keys.map((k) => '"$k" = ?').join(', ');
    final allParams = [...values.values, ...whereParams];
    return query(
      'UPDATE "$table" SET $sets WHERE $where',
      params: allParams,
      slug: slug,
    );
  }

  /// Delete rows from a table.
  Future<Map<String, dynamic>> delete(
    String table,
    String where,
    List<dynamic> whereParams, {
    String? slug,
  }) async {
    return query(
      'DELETE FROM "$table" WHERE $where',
      params: whereParams,
      slug: slug,
    );
  }

  // ─── Storage ──────────────────────────────────────────

  /// Get a presigned upload URL for a file.
  Future<Map<String, dynamic>> getUploadUrl(
    String filename, {
    String? contentType,
    String? slug,
  }) async {
    final projectSlug = slug ?? this.projectSlug;
    if (projectSlug == null) {
      throw KeelException(code: 'NO_PROJECT', message: 'projectSlug is required', statusCode: 400);
    }
    return _post('/project/$projectSlug/storage/upload-url', {
      'filename': filename,
      'content_type': contentType,
    });
  }

  /// Get a presigned download URL for a file.
  Future<Map<String, dynamic>> getDownloadUrl(
    String key, {
    String? slug,
  }) async {
    final projectSlug = slug ?? this.projectSlug;
    if (projectSlug == null) {
      throw KeelException(code: 'NO_PROJECT', message: 'projectSlug is required', statusCode: 400);
    }
    return _get('/project/$projectSlug/storage/download-url?key=${Uri.encodeComponent(key)}');
  }

  // ─── OAuth (project-scoped) ───────────────────────────

  /// Get the Google OAuth authorization URL for a project's end users.
  String buildGoogleOAuthUrl(String slug) {
    return '$baseUrl/project/$slug/auth/google';
  }

  /// Get the GitHub OAuth authorization URL for a project's end users.
  String buildGithubOAuthUrl(String slug) {
    return '$baseUrl/project/$slug/auth/github';
  }

  // ─── Dio access ───────────────────────────────────────

  /// Access the configured Dio instance for custom requests.
  Dio get dio => _dio;

  // ─── HTTP helpers (for raw access) ────────────────────

  Future<Map<String, dynamic>> rawGet(String path) => _get(path);
  Future<Map<String, dynamic>> rawPost(String path, Map<String, dynamic> body) => _post(path, body);

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

  Future<Map<String, dynamic>> _put(String path, Map<String, dynamic> body) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = _buildHeaders()..['Content-Type'] = 'application/json';
    final res = await http.put(uri, headers: headers, body: jsonEncode(body));
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
    if (_apiKey != null) {
      headers['X-Api-Key'] = _apiKey;
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

/// Auth interceptor for Dio that auto-refreshes JWT on 401.
class _KeelAuthInterceptor extends Interceptor {
  final KeelClient _client;

  _KeelAuthInterceptor(this._client);

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (_client._accessToken != null) {
      options.headers['Authorization'] = 'Bearer ${_client._accessToken}';
    }
    if (_client._apiKey != null) {
      options.headers['X-Api-Key'] = _client._apiKey;
    }
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode == 401 && _client._refreshToken != null) {
      try {
        await _client.refreshAccessToken();

        // Retry the request with new token
        final options = err.requestOptions;
        options.headers['Authorization'] = 'Bearer ${_client._accessToken}';

        final response = await _client._dio.fetch(options);
        handler.resolve(response);
        return;
      } catch (_) {
        // Refresh failed — propagate original error
      }
    }
    handler.next(err);
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
