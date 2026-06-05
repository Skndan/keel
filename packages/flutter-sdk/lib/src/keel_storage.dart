import 'dart:io';
import 'package:http/http.dart' as http;

/// Keel Storage helper for uploading files via presigned URLs.
class KeelStorage {
  /// Upload a file to Keel storage using a presigned URL.
  ///
  /// [uploadUrl] - The presigned URL from getUploadUrl()
  /// [filePath] - Local path to the file
  /// [contentType] - Optional MIME type
  static Future<void> uploadFile({
    required String uploadUrl,
    required String filePath,
    String? contentType,
  }) async {
    final file = File(filePath);
    if (!await file.exists()) {
      throw Exception('File not found: $filePath');
    }

    final bytes = await file.readAsBytes();
    final res = await http.put(
      Uri.parse(uploadUrl),
      headers: {
        if (contentType != null) 'Content-Type': contentType,
        'Content-Length': bytes.length.toString(),
      },
      body: bytes,
    );

    if (res.statusCode != 200) {
      throw Exception('Upload failed: ${res.statusCode} ${res.body}');
    }
  }

  /// Download a file from Keel storage using a presigned URL.
  static Future<Uint8List> downloadFile(String downloadUrl) async {
    final res = await http.get(Uri.parse(downloadUrl));
    if (res.statusCode != 200) {
      throw Exception('Download failed: ${res.statusCode}');
    }
    return res.bodyBytes;
  }
}
