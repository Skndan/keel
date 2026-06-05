import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';

/// Realtime subscription handler.
typedef RealtimeCallback = void Function(Map<String, dynamic> data);

/// Keel Realtime client for WebSocket subscriptions.
class KeelRealtime {
  final String wsUrl;
  final String? _accessToken;

  WebSocketChannel? _channel;
  final Map<String, List<RealtimeCallback>> _listeners = {};
  Timer? _pingTimer;

  KeelRealtime({
    required this.wsUrl,
    String? accessToken,
  }) : _accessToken = accessToken;

  /// Connect to the WebSocket server.
  void connect() {
    final uri = _accessToken != null
        ? Uri.parse('$wsUrl?token=$_accessToken')
        : Uri.parse(wsUrl);

    _channel = WebSocketChannel.connect(uri);

    _channel!.stream.listen(
      (data) {
        try {
          final msg = jsonDecode(data as String) as Map<String, dynamic>;
          final type = msg['type'] as String?;
          final channel = msg['channel'] as String?;

          if (type == 'data' && channel != null) {
            final callbacks = _listeners[channel];
            if (callbacks != null) {
              final payload = msg['payload'] as Map<String, dynamic>?;
              for (final cb in callbacks) {
                cb(payload ?? {});
              }
            }
          }
        } catch (_) {}
      },
      onError: (error) {
        print('KeelRealtime error: $error');
      },
      onDone: () {
        print('KeelRealtime disconnected');
      },
    );

    // Keep alive with ping every 30 seconds
    _pingTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      _send({'type': 'ping'});
    });
  }

  /// Subscribe to changes on a project channel.
  void subscribe(String project, String channel, RealtimeCallback callback) {
    final fullChannel = '$project:$channel';
    _listeners.putIfAbsent(fullChannel, () => []);
    _listeners[fullChannel]!.add(callback);

    _send({
      'type': 'subscribe',
      'channel': fullChannel,
      'project': project,
    });
  }

  /// Unsubscribe from a channel.
  void unsubscribe(String project, String channel) {
    final fullChannel = '$project:$channel';
    _listeners.remove(fullChannel);

    _send({
      'type': 'unsubscribe',
      'channel': fullChannel,
    });
  }

  /// Disconnect from the WebSocket server.
  void disconnect() {
    _pingTimer?.cancel();
    _channel?.sink.close();
    _listeners.clear();
  }

  void _send(Map<String, dynamic> msg) {
    _channel?.sink.add(jsonEncode(msg));
  }
}
