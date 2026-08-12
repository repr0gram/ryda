import Foundation

/// Errors that mean the payload cannot be trusted, rather than crashing on it.
public enum StreamError: Error, Sendable, Equatable {
    case notBase64(channel: String)
    /// Byte count is not a whole number of elements, or not the expected count.
    case length(channel: String, got: Int, want: Int)
}

/// Decodes the raw typed-array buffers the API sends as base64.
///
/// Two things about this are worth stating rather than assuming.
///
/// **Endianness.** Node writes typed arrays in the host's byte order and
/// nothing byte-swaps anywhere in the pipeline. It works because Vercel's
/// runners and every Apple device are little-endian — a coincidence of two
/// platforms, not a contract. Decoding explicitly little-endian costs nothing
/// measurable and removes the coincidence.
///
/// **Alignment.** `Data(base64Encoded:)` makes no alignment promise, and
/// `withUnsafeBytes { $0.load(as: Double.self) }` *traps* on a misaligned
/// address. In practice a freshly allocated `Data` is aligned and it appears to
/// work, right up until a `Data` that is a slice of something else isn't — a
/// crash on one device and not another. `loadUnaligned` is legal at any offset,
/// so it is used unconditionally.
public enum ChannelDecoder {
    public static func float64(
        _ base64: String,
        expecting count: Int,
        channel: String = "?"
    ) throws -> [Double] {
        let data = try bytes(base64, channel: channel)
        try check(data.count, want: count * 8, channel: channel)
        return data.withUnsafeBytes { raw in
            (0..<count).map { i in
                Double(
                    bitPattern: UInt64(
                        littleEndian: raw.loadUnaligned(fromByteOffset: i * 8, as: UInt64.self)
                    )
                )
            }
        }
    }

    public static func float32(
        _ base64: String,
        expecting count: Int,
        channel: String = "?"
    ) throws -> [Float] {
        let data = try bytes(base64, channel: channel)
        try check(data.count, want: count * 4, channel: channel)
        return data.withUnsafeBytes { raw in
            (0..<count).map { i in
                Float(
                    bitPattern: UInt32(
                        littleEndian: raw.loadUnaligned(fromByteOffset: i * 4, as: UInt32.self)
                    )
                )
            }
        }
    }

    public static func uint8(
        _ base64: String,
        expecting count: Int,
        channel: String = "?"
    ) throws -> [UInt8] {
        let data = try bytes(base64, channel: channel)
        try check(data.count, want: count, channel: channel)
        return [UInt8](data)
    }

    private static func bytes(_ base64: String, channel: String) throws -> Data {
        guard let data = Data(base64Encoded: base64) else {
            throw StreamError.notBase64(channel: channel)
        }
        return data
    }

    /// Length is validated, not assumed. Nothing server-side checks that every
    /// channel matches `sampleCount`, and a response truncated by a flaky
    /// connection would otherwise be read past its end.
    private static func check(_ got: Int, want: Int, channel: String) throws {
        guard got == want else {
            throw StreamError.length(channel: channel, got: got, want: want)
        }
    }
}
