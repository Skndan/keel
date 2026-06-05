/// Keel BaaS Flutter SDK
///
/// A first-class Flutter client for the Keel backend.
///
/// Usage:
/// ```dart
/// import 'package:keel_sdk/keel_sdk.dart';
///
/// final client = KeelClient(
///   baseUrl: 'https://my-keel.example.com/v1',
///   projectSlug: 'my-app',
///   apiKey: 'keel_my-app_abc123...',
/// );
///
/// // Database operations
/// final users = await client.select('users', limit: 10);
///
/// // Storage
/// final uploadUrl = await client.getUploadUrl('photo.jpg');
/// await KeelStorage.uploadFile(uploadUrl: uploadUrl, filePath: '/path/photo.jpg');
///
/// // Realtime
/// final realtime = KeelRealtime(
///   wsUrl: 'wss://my-keel.example.com/ws',
///   projectSlug: 'my-app',
/// );
/// realtime.connect();
/// realtime.channel('users').listen((data) => print(data));
/// ```
library keel_sdk;

export 'src/keel_client.dart';
export 'src/keel_auth.dart';
export 'src/keel_realtime.dart';
export 'src/keel_storage.dart';
