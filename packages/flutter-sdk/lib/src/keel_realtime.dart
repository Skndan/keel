import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';

/// Realtime subscription handler (legacy callback).
typedef RealtimeCallback = void Function(Map<String, dynamic> data);

/// A single realtime subscription.
class RealtimeSubscription {
  final String channel;
  final KeelRealtime _realtime;

  RealtimeSubscription._(this.channel, this._realtime);

  /// Cancel this subscription.
  void cancel() {
    _realtime.unsubscribeChannel(channel);
  }
}

/// Keel Realtime client for WebSocket subscriptions.
///
/// Provides both a callback-based API and a [Stream]-based API
/// for subscribing to database changes in real time.
///
/// Stream-based usage:
/// ```dart
/// final realtime = KeelRealtime(
///   wsUrl: 'wss://my-keel.example.com/ws',
///   projectSlug: 'my-app',
/// );
///
/// final sub = realtime.channel('my-channel').listen((data) {
///   print('Received: $data');
/// });
///
/// // Later: sub.cancel();
/// ```
class KeelRealtime {
  final String wsUrl;
  final String? projectSlug;
  final String? _accessToken;

  WebSocketChannel? _channel;
  final Map<String, List<RealtimeCallback>> _listeners = {};
  final Map<String, StreamController<Map<String, dynamic>>> _streamControllers = {};
  Timer? _pingTimer;
  bool _connected = false;

  /// Creates a new KeelRealtime client.
  ///
  /// [wsUrl] — WebSocket URL (e.g. wss://my-keel.example.com/ws)
  /// [projectSlug] — default project slug for subscriptions
  /// [accessToken] — JWT access token for authenticated connections
  KeelRealtime({
    required this.wsUrl,
    this.projectSlug,
    String? accessToken,
  }) : _accessToken = accessToken;

  /// Whether the client is currently connected.
  bool get isConnected => _connected;

  /// Connect to the WebSocket server.
  void connect() {
    if (_connected) return;

    final uri = _accessToken != null
        ? Uri.parse('$wsUrl?token=$_accessToken')
        : Uri.parse(wsUrl);

    _channel = WebSocketChannel.connect(uri);
    _connected = true;

    _channel!.stream.listen(
      _handleMessage,
      onError: (error) {
        _connected = false;
        _broadcastError('Connection error: $error');
      },
      onDone: () {
        _connected = false;
        _broadcastError('Disconnected');
      },
    );

    // Ping every 30 seconds to keep alive
    _pingTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      _send({'type': 'ping'});
    });
  }

  /// Subscribe using a callback (legacy API).
  void subscribe(
    String channel, {
    String? project,
    required RealtimeCallback callback,
  }) {
    final fullChannel = project != null ? '$project:$channel' : channel;
    _listeners.putIfAbsent(fullChannel, () => []);
    _listeners[fullChannel]!.add(callback);

    if (_connected) {
      _send({
        'type': 'subscribe',
        'channel': fullChannel,
        'project': project ?? projectSlug,
      });
    }
  }

  /// Create a [Stream] subscription to a channel.
  ///
  /// ```dart
  /// final sub = realtime.channel('my-table').listen((data) {
  ///   // handle realtime data
  /// });
  /// ```
  Stream<Map<String, dynamic>> channel(String channel, {String? project}) {
    final fullChannel = project != null ? '$project:$channel' : channel;
    final controller = StreamController<Map<String, dynamic>>.broadcast(
      onCancel: () {
        unsubscribeChannel(fullChannel);
        _streamControllers.remove(fullChannel);
      },
    );

    _streamControllers[fullChannel] = controller;

    if (_connected) {
      _send({
        'type': 'subscribe',
        'channel': fullChannel,
        'project': project ?? projectSlug,
      });
    }

    return controller.stream;
  }

  /// Unsubscribe using the old API.
  void unsubscribe(String channel, {String? project}) {
    final fullChannel = project != null ? '$project:$channel' : channel;
    unsubscribeChannel(fullChannel);
  }

  /// Internal unsubscribe by full channel name.
  void unsubscribeChannel(String fullChannel) {
    _listeners.remove(fullChannel);
    _streamControllers[fullChannel]?.close();
    _streamControllers.remove(fullChannel);

    if (_connected) {
      _send({
        'type': 'unsubscribe',
        'channel': fullChannel,
      });
    }
  }

  /// Disconnect from WebSocket.
  void disconnect() {
    _connected = false;
    _pingTimer?.cancel();
    _channel?.sink.close();
    _listeners.clear();

    for (final c in _streamControllers.values) {
      c.close();
    }
    _streamControllers.clear();
  }

  void _handleMessage(dynamic data) {
    try {
      final msg = jsonDecode(data as String) as Map<String, dynamic>;
      final type = msg['type'] as String?;
      final channel = msg['channel'] as String?;

      if (type == 'data' && channel != null) {
        final payload = (msg['payload'] as Map<String, dynamic>?) ?? {};

        // Callbacks
        final callbacks = _listeners[channel];
        if (callbacks != null) {
          for (final cb in callbacks) {
            cb(payload);
          }
        }

        // Stream
        final controller = _streamControllers[channel];
        if (controller != null && controller.hasListener) {
          controller.add(payload);
        }
      } else if (type == 'error') {
        _broadcastError(msg['payload']?.toString() ?? 'Unknown error');
      }
    } catch (_) {
      // Ignore malformed messages
    }
  }

  void _broadcastError(String message) {
    final errorData = {'error': message};
    for (final callbacks in _listeners.values) {
      for (final cb in callbacks) {
        cb(errorData);
      }
    }
    for (final c in _streamControllers.values) {
      if (c.hasListener) {
        c.addError(message);
      }
    }
  }

  void _send(Map<String, dynamic> msg) {
    _channel?.sink.add(jsonEncode(msg));
  }
}
