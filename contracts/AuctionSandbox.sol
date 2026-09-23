// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice TEST ONLY. Virtual credits, no ETH/ERC20 custody, no withdrawals.
/// One bounded batch. Orders immutable after commit; list completeness checked.
contract AuctionSandbox {
    struct Order { address owner; bool buy; uint32 price; uint32 quantity; uint32 filled; }
    address public immutable coordinator;
    uint16 public immutable feeBps;
    bool public immutable singleSeller;
    Order[] public orders;
    uint256[] private buys;
    uint256[] private sells;
    uint256 public bi;
    uint256 public si;
    uint256 public volume;
    uint32 public clearingPrice;
    bool public committed;
    bool public done;
    bool public settled;
    uint256 public totalFees;
    mapping(address => uint256) public base;
    mapping(address => uint256) public quote;
    mapping(address => bool) public minted;
    event Submitted(uint256 indexed id, address indexed owner);
    event Matched(uint256 indexed buyId, uint256 indexed sellId, uint32 quantity);
    constructor(uint16 fee, bool single) {
        require(fee <= 1000, "fee"); coordinator = msg.sender; feeBps = fee; singleSeller = single;
    }
    function faucet() external {
        require(!minted[msg.sender] && !committed, "mint"); minted[msg.sender] = true;
        base[msg.sender] = 1 << 100; quote[msg.sender] = 1 << 100;
    }
    function submit(bool buy, uint32 price, uint32 quantity) external {
        require(!committed && orders.length < 64 && price > 0 && quantity > 0, "order");
        if (buy) { uint256 deposit = uint256(price) * quantity; require(quote[msg.sender] >= deposit, "quote"); quote[msg.sender] -= deposit; }
        else { require(base[msg.sender] >= quantity, "base"); base[msg.sender] -= quantity; }
        orders.push(Order(msg.sender, buy, price, quantity, 0)); emit Submitted(orders.length - 1, msg.sender);
    }
    function commit(uint256[] calldata b, uint256[] calldata s) external {
        require(msg.sender == coordinator && !committed && b.length + s.length == orders.length, "commit");
        require(!singleSeller || s.length == 1, "seller");
        uint256 seen;
        for (uint256 side; side < 2; side++) {
            uint256[] calldata list = side == 0 ? b : s;
            for (uint256 i; i < list.length; i++) {
                uint256 id = list[i]; require(id < orders.length && seen & (uint256(1) << id) == 0, "duplicate");
                seen |= uint256(1) << id; Order storage o = orders[id]; require(o.buy == (side == 0), "side");
                if (i > 0) {
                    uint256 prevId = list[i - 1]; Order storage prev = orders[prevId];
                    require(prev.price == o.price ? prevId < id : (side == 0 ? prev.price > o.price : prev.price < o.price), "priority");
                }
                if (side == 0) buys.push(id); else sells.push(id);
            }
        }
        committed = true;
    }
    function step(uint256 maxSteps) external {
        require(committed && !done && maxSteps > 0 && maxSteps <= 64, "step");
        for (uint256 n; n < maxSteps; n++) {
            if (bi == buys.length || si == sells.length) { done = true; break; }
            Order storage b = orders[buys[bi]]; Order storage s = orders[sells[si]];
            if (b.price < s.price) { done = true; break; }
            uint32 bq = b.quantity - b.filled; uint32 sq = s.quantity - s.filled; uint32 fill = bq < sq ? bq : sq;
            b.filled += fill; s.filled += fill; volume += fill; clearingPrice = s.price;
            emit Matched(buys[bi], sells[si], fill);
            if (fill == bq) bi++; if (fill == sq) si++;
        }
    }
    function settle() external {
        require(done && !settled, "settle"); settled = true;
        uint256 paid; uint256 received; uint256 bought; uint256 sold;
        for (uint256 i; i < orders.length; i++) {
            Order storage o = orders[i]; uint256 gross = uint256(o.filled) * clearingPrice;
            if (o.buy) {
                require(o.filled == 0 || clearingPrice <= o.price, "buy limit");
                base[o.owner] += o.filled; quote[o.owner] += uint256(o.price) * o.quantity - gross; paid += gross; bought += o.filled;
            } else {
                require(o.filled == 0 || clearingPrice >= o.price, "sell limit");
                uint256 fee = gross * feeBps / 10000; totalFees += fee;
                quote[o.owner] += gross - fee; base[o.owner] += o.quantity - o.filled; received += gross - fee; sold += o.filled;
            }
        }
        quote[coordinator] += totalFees;
        require(bought == sold && bought == volume && paid == received + totalFees, "conservation");
    }
    function directMatch(uint32 bp, uint32 sp, uint32 bq, uint32 sq) external pure returns (bool matched, uint32 fill, uint32 br, uint32 sr) {
        matched = bp > 0 && sp > 0 && bq > 0 && sq > 0 && bp >= sp;
        fill = matched ? (bq < sq ? bq : sq) : 0; br = bq - fill; sr = sq - fill;
    }
}
