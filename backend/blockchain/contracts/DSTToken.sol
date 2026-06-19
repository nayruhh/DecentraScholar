// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./OwnableLite.sol";

contract DSTToken is OwnableLite {
    string public constant name = "DecentraScholar Token";
    string public constant symbol = "DST";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public minters;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event MinterUpdated(address indexed account, bool allowed);

    error Unauthorized();
    error InsufficientBalance();
    error InsufficientAllowance();

    constructor(address initialOwner) OwnableLite(initialOwner) {}

    modifier onlyMinter() {
        if (msg.sender != owner && !minters[msg.sender]) revert Unauthorized();
        _;
    }

    function setMinter(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        minters[account] = allowed;
        emit MinterUpdated(account, allowed);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance();
        allowance[from][msg.sender] = allowed - amount;
        emit Approval(from, msg.sender, allowance[from][msg.sender]);
        _transfer(from, to, amount);
        return true;
    }

    function mint(address to, uint256 amount) external onlyMinter {
        if (to == address(0)) revert ZeroAddress();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(uint256 amount) external {
        uint256 current = balanceOf[msg.sender];
        if (current < amount) revert InsufficientBalance();
        balanceOf[msg.sender] = current - amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        uint256 current = balanceOf[from];
        if (current < amount) revert InsufficientBalance();
        balanceOf[from] = current - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
