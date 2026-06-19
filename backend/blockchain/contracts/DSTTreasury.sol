// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./OwnableLite.sol";
import "./DSTToken.sol";

contract DSTTreasury is OwnableLite {
    DSTToken public immutable dstToken;
    uint256 public immutable weiPerToken;

    event TokensPurchased(address indexed buyer, uint256 tokenAmount, uint256 ethPaid);
    event TokensRedeemed(address indexed redeemer, uint256 tokenAmount, uint256 ethReturned);
    event TreasuryFunded(address indexed funder, uint256 amountWei);
    event TreasuryWithdrawal(address indexed receiver, uint256 amountWei);

    error InvalidAmount();
    error InvalidPayment();
    error InsufficientLiquidity();
    error EthTransferFailed();

    constructor(address initialOwner, address tokenAddress, uint256 priceWeiPerToken)
        OwnableLite(initialOwner)
    {
        if (tokenAddress == address(0)) revert ZeroAddress();
        if (priceWeiPerToken == 0) revert InvalidAmount();
        dstToken = DSTToken(tokenAddress);
        weiPerToken = priceWeiPerToken;
    }

    receive() external payable {
        emit TreasuryFunded(msg.sender, msg.value);
    }

    function buy(uint256 tokenAmount) external payable {
        if (tokenAmount == 0) revert InvalidAmount();
        uint256 requiredWei = getEthCost(tokenAmount);
        if (msg.value != requiredWei) revert InvalidPayment();

        dstToken.mint(msg.sender, tokenAmount);
        emit TokensPurchased(msg.sender, tokenAmount, msg.value);
    }

    function redeem(uint256 tokenAmount) external {
        if (tokenAmount == 0) revert InvalidAmount();
        uint256 ethAmount = getEthCost(tokenAmount);
        if (address(this).balance < ethAmount) revert InsufficientLiquidity();

        dstToken.transferFrom(msg.sender, address(this), tokenAmount);
        dstToken.burn(tokenAmount);

        (bool ok, ) = payable(msg.sender).call{value: ethAmount}("");
        if (!ok) revert EthTransferFailed();

        emit TokensRedeemed(msg.sender, tokenAmount, ethAmount);
    }

    function fundTreasury() external payable {
        emit TreasuryFunded(msg.sender, msg.value);
    }

    function ownerWithdrawEth(address payable receiver, uint256 amountWei) external onlyOwner {
        if (receiver == address(0)) revert ZeroAddress();
        if (amountWei == 0) revert InvalidAmount();
        if (address(this).balance < amountWei) revert InsufficientLiquidity();

        (bool ok, ) = receiver.call{value: amountWei}("");
        if (!ok) revert EthTransferFailed();

        emit TreasuryWithdrawal(receiver, amountWei);
    }

    function getEthCost(uint256 tokenAmount) public view returns (uint256) {
        return (tokenAmount * weiPerToken) / 1 ether;
    }
}
