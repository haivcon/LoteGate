// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
/// @notice Benchmark only: combinational NAND bytecode passed as calldata.
/// Not the TapeOut CPU, not an authenticated matcher, not used for settlement.
contract NandBenchmark {
    function evaluate(bytes calldata net, bytes calldata input, uint256 nIn, uint256 nOut) external pure returns (bytes memory output) {
        require(net.length % 7 == 0 && net.length <= 100000 && nIn <= 255 && nOut <= 255 && input.length == (nIn + 7) / 8, "dimensions");
        uint256 count = net.length / 7; require(count >= nOut, "outputs");
        bytes memory v = new bytes(2 + nIn + count); v[1] = bytes1(uint8(1));
        for (uint256 i; i < nIn; i++) v[2 + i] = bytes1((uint8(input[i >> 3]) >> (i & 7)) & 1);
        for (uint256 i; i < count; i++) {
            uint256 p = i * 7; require(net[p] == 0, "opcode");
            uint256 a = (uint256(uint8(net[p+1])) << 16) | (uint256(uint8(net[p+2])) << 8) | uint8(net[p+3]);
            uint256 b = (uint256(uint8(net[p+4])) << 16) | (uint256(uint8(net[p+5])) << 8) | uint8(net[p+6]);
            uint256 index = 2 + nIn + i; require(a < index && b < index, "forward reference");
            v[index] = bytes1(uint8(1) ^ (uint8(v[a]) & uint8(v[b])));
        }
        output = new bytes((nOut + 7) / 8);
        for (uint256 i; i < nOut; i++) output[i >> 3] |= bytes1(uint8(v[v.length - nOut + i]) << (i & 7));
    }
}
