import 'dart:io';
import 'dart:typed_data';
import 'package:http/http.dart' as http;

/// Keel Storage helper for uploading and downloading files via presigned URLs.
class KeelStorage {
  /// Upload a file to Keel/R2 storage using a presigned URL.
  ///
  /// [uploadUrl] — The presigned URL from getUploadUrl()
  /// [filePath] — Local path to the file
  /// [contentType] — Optional MIME type (auto-detected if not provided)
  static Future<void> uploadFile({
    required String uploadUrl,
    required String filePath,
    String? contentType,
  }) async {
    final file = File(filePath);
    if (!await file.exists()) {
      throw KeelStorageException('File not found: $filePath');
    }

    final bytes = await file.readAsBytes();
    await uploadBytes(
      uploadUrl: uploadUrl,
      bytes: bytes,
      contentType: contentType,
      filename: filePath.split('/').last,
    );
  }

  /// Upload bytes directly to Keel/R2 storage using a presigned URL.
  static Future<void> uploadBytes({
    required String uploadUrl,
    required Uint8List bytes,
    String? contentType,
    String? filename,
  }) async {
    final res = await http.put(
      Uri.parse(uploadUrl),
      headers: {
        if (contentType != null) 'Content-Type': contentType,
        'Content-Length': bytes.length.toString(),
        if (filename != null)
          'Content-Disposition': 'attachment; filename="$filename"',
      },
      body: bytes,
    );

    if (res.statusCode != 200) {
      throw KeelStorageException(
        'Upload failed: ${res.statusCode} ${res.body}',
      );
    }
  }

  /// Download a file from Keel/R2 storage using a presigned URL.
  ///
  /// Returns the raw bytes of the file.
  static Future<Uint8List> downloadBytes(String downloadUrl) async {
    final res = await http.get(Uri.parse(downloadUrl));
    if (res.statusCode != 200) {
      throw KeelStorageException(
        'Download failed: ${res.statusCode}',
      );
    }
    return res.bodyBytes;
  }

  /// Download a file and save it to the local filesystem.
  static Future<File> downloadToFile({
    required String downloadUrl,
    required String savePath,
  }) async {
    final bytes = await downloadBytes(downloadUrl);
    final file = File(savePath);
    await file.writeAsBytes(bytes);
    return file;
  }

  /// Get the public URL for a stored file (if r2_public_url is configured).
  ///
  /// [publicBaseUrl] — The r2_public_url from project config
  /// [key] — The file's storage key
  static String getPublicUrl(String publicBaseUrl, String key) {
    final base = publicBaseUrl.endsWith('/')
        ? publicBaseUrl.substring(0, publicBaseUrl.length - 1)
        : publicBaseUrl;
    return '$base/$key';
  }
}

/// Exception thrown by KeelStorage operations.
class KeelStorageException implements Exception {
  final String message;

  KeelStorageException(this.message);

  @override
  String toString() => 'KeelStorageException: $message';
}
