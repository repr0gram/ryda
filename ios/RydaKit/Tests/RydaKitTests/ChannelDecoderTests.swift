import Testing
import Foundation
@testable import RydaKit

/// Base64 of a typed array, exactly as the server produces it.
private func encode<T>(_ values: [T]) -> String {
    values.withUnsafeBytes { Data($0).base64EncodedString() }
}

@Suite("ChannelDecoder")
struct ChannelDecoderTests {
    @Test("round-trips Float64 exactly, including full coordinate precision")
    func float64RoundTrip() throws {
        // These are real coordinates from a Montreal ride. A Float32 would round
        // them to about a metre of wobble, which is why latlng is Float64 on the
        // wire and must stay Double here.
        let original: [Double] = [45.4969699960202, -73.55175998993218, 0, -0.5, 1e-9, 12345.6789]
        let decoded = try ChannelDecoder.float64(encode(original), expecting: original.count)
        #expect(decoded == original)
    }

    @Test("round-trips Float32 exactly")
    func float32RoundTrip() throws {
        let original: [Float] = [0, 1.5, 454, -12.25, 3.4028235e38]
        let decoded = try ChannelDecoder.float32(encode(original), expecting: original.count)
        #expect(decoded == original)
    }

    @Test("round-trips UInt8")
    func uint8RoundTrip() throws {
        let original: [UInt8] = [0, 1, 1, 0, 255]
        let decoded = try ChannelDecoder.uint8(encode(original), expecting: original.count)
        #expect(decoded == original)
    }

    @Test("decodes correctly from a misaligned buffer")
    func misalignedBuffer() throws {
        // The real hazard: base64 makes no alignment promise, and loading a
        // Double from an address that is not a multiple of 8 traps. Force the
        // condition by shifting a payload one byte and slicing it back out —
        // a freshly allocated Data would be aligned and prove nothing.
        let values: [Double] = [1.25, 2.5, 3.75, 45.4969699960202]
        var shifted = Data([0xFF])
        shifted.append(values.withUnsafeBytes { Data($0) })
        let slice = shifted.dropFirst()
        #expect(slice.count == values.count * 8)

        let decoded = try ChannelDecoder.float64(
            slice.base64EncodedString(), expecting: values.count
        )
        #expect(decoded == values)
    }

    @Test("rejects a truncated channel instead of reading past its end")
    func truncated() throws {
        let original: [Double] = [1, 2, 3, 4]
        #expect(throws: StreamError.self) {
            // A response cut short by a flaky connection. Claiming 10 samples
            // over 4 samples of bytes must fail loudly, not read garbage.
            try ChannelDecoder.float64(encode(original), expecting: 10, channel: "time")
        }
    }

    @Test("rejects bytes that are not a whole number of elements")
    func ragged() throws {
        let bytes = Data([1, 2, 3, 4, 5])
        #expect(throws: StreamError.self) {
            try ChannelDecoder.float64(bytes.base64EncodedString(), expecting: 1)
        }
    }

    @Test("rejects a string that is not base64")
    func notBase64() throws {
        #expect(throws: StreamError.self) {
            try ChannelDecoder.float64("this is not base64!!!", expecting: 1)
        }
    }

    @Test("handles an empty channel")
    func empty() throws {
        #expect(try ChannelDecoder.float64("", expecting: 0).isEmpty)
    }

    @Test("decodes little-endian regardless of how the host would order it")
    func explicitEndianness() throws {
        // 1.0 as a Float64 is 0x3FF0000000000000. Little-endian on the wire puts
        // the low byte first, so this exact byte sequence must read as 1.0 — the
        // assertion that would fail if anyone "fixed" the decoder to use host
        // byte order on a big-endian machine.
        let littleEndian = Data([0, 0, 0, 0, 0, 0, 0xF0, 0x3F])
        let decoded = try ChannelDecoder.float64(littleEndian.base64EncodedString(), expecting: 1)
        #expect(decoded == [1.0])
    }
}
