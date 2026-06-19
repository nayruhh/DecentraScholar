// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./OwnableLite.sol";
import "./DSTToken.sol";

contract DSTProtocolVault is OwnableLite {
    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant DEFAULT_REWARD_POOL_SHARE_BPS = 7_500;

    struct PaperFunding {
        uint256 totalSubmitted;
        uint256 priorityFeesSubmitted;
        uint256 rewardPoolRemaining;
        uint256 feeVaultAccrued;
    }

    struct ReviewerStake {
        uint256 amount;
        bool active;
    }

    DSTToken public immutable dstToken;
    mapping(address => bool) public coordinators;
    mapping(bytes32 => PaperFunding) private paperFunding;
    mapping(bytes32 => mapping(address => ReviewerStake)) private reviewerStakes;

    uint256 public feeVaultBalance;

    event CoordinatorUpdated(address indexed coordinator, bool allowed);
    event SubmissionFeeReserved(
        bytes32 indexed paperId,
        address indexed author,
        uint256 totalAmount,
        uint256 rewardPoolAmount,
        uint256 feeVaultAmount
    );
    event PriorityFeeReserved(
        bytes32 indexed paperId,
        address indexed author,
        uint256 totalAmount,
        uint256 rewardPoolAmount
    );
    event ReviewerStakeLocked(bytes32 indexed paperId, address indexed reviewer, uint256 amount);
    event ReviewerSettled(
        bytes32 indexed paperId,
        address indexed reviewer,
        uint256 rewardAmount,
        uint256 slashedAmount,
        uint256 refundedStake
    );
    event FeeVaultWithdrawal(address indexed receiver, uint256 amount);

    error Unauthorized();
    error InvalidAmount();
    error TransferFailed();
    error StakeAlreadyLocked();
    error StakeMissing();
    error InsufficientRewardPool();
    error InvalidSettlement();

    constructor(address initialOwner, address tokenAddress) OwnableLite(initialOwner) {
        if (tokenAddress == address(0)) revert ZeroAddress();
        dstToken = DSTToken(tokenAddress);
    }

    modifier onlyCoordinator() {
        if (msg.sender != owner && !coordinators[msg.sender]) revert Unauthorized();
        _;
    }

    function setCoordinator(address coordinator, bool allowed) external onlyOwner {
        if (coordinator == address(0)) revert ZeroAddress();
        coordinators[coordinator] = allowed;
        emit CoordinatorUpdated(coordinator, allowed);
    }

    function reserveSubmissionFee(bytes32 paperId, uint256 totalAmount) external {
        if (paperId == bytes32(0) || totalAmount == 0) revert InvalidAmount();

        uint256 rewardPoolAmount = (totalAmount * DEFAULT_REWARD_POOL_SHARE_BPS) / BASIS_POINTS;
        uint256 feeVaultAmount = totalAmount - rewardPoolAmount;

        if (!dstToken.transferFrom(msg.sender, address(this), totalAmount)) revert TransferFailed();

        PaperFunding storage funding = paperFunding[paperId];
        funding.totalSubmitted += totalAmount;
        funding.rewardPoolRemaining += rewardPoolAmount;
        funding.feeVaultAccrued += feeVaultAmount;
        feeVaultBalance += feeVaultAmount;

        emit SubmissionFeeReserved(paperId, msg.sender, totalAmount, rewardPoolAmount, feeVaultAmount);
    }

    function reservePriorityFee(bytes32 paperId, uint256 totalAmount) external {
        if (paperId == bytes32(0) || totalAmount == 0) revert InvalidAmount();

        if (!dstToken.transferFrom(msg.sender, address(this), totalAmount)) revert TransferFailed();

        PaperFunding storage funding = paperFunding[paperId];
        funding.totalSubmitted += totalAmount;
        funding.priorityFeesSubmitted += totalAmount;
        funding.rewardPoolRemaining += totalAmount;

        emit PriorityFeeReserved(paperId, msg.sender, totalAmount, totalAmount);
    }

    function lockReviewerStake(bytes32 paperId, uint256 amount) external {
        if (paperId == bytes32(0) || amount == 0) revert InvalidAmount();

        ReviewerStake storage stake = reviewerStakes[paperId][msg.sender];
        if (stake.active) revert StakeAlreadyLocked();

        if (!dstToken.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        reviewerStakes[paperId][msg.sender] = ReviewerStake({ amount: amount, active: true });
        emit ReviewerStakeLocked(paperId, msg.sender, amount);
    }

    function settleReviewer(
        bytes32 paperId,
        address reviewer,
        uint256 rewardAmount,
        uint256 slashedAmount
    ) external onlyCoordinator {
        if (paperId == bytes32(0) || reviewer == address(0)) revert InvalidAmount();

        ReviewerStake storage stake = reviewerStakes[paperId][reviewer];
        if (!stake.active) revert StakeMissing();
        if (slashedAmount > stake.amount) revert InvalidSettlement();

        PaperFunding storage funding = paperFunding[paperId];
        if (rewardAmount > funding.rewardPoolRemaining) revert InsufficientRewardPool();

        funding.rewardPoolRemaining -= rewardAmount;
        funding.feeVaultAccrued += slashedAmount;
        feeVaultBalance += slashedAmount;

        uint256 refundedStake = stake.amount - slashedAmount;
        delete reviewerStakes[paperId][reviewer];

        if (rewardAmount > 0 && !dstToken.transfer(reviewer, rewardAmount)) revert TransferFailed();
        if (refundedStake > 0 && !dstToken.transfer(reviewer, refundedStake)) revert TransferFailed();

        emit ReviewerSettled(paperId, reviewer, rewardAmount, slashedAmount, refundedStake);
    }

    function ownerWithdrawFeeVault(address receiver, uint256 amount) external onlyOwner {
        if (receiver == address(0) || amount == 0) revert InvalidAmount();
        if (amount > feeVaultBalance) revert InvalidSettlement();

        feeVaultBalance -= amount;
        if (!dstToken.transfer(receiver, amount)) revert TransferFailed();

        emit FeeVaultWithdrawal(receiver, amount);
    }

    function getPaperFunding(bytes32 paperId) external view returns (PaperFunding memory) {
        return paperFunding[paperId];
    }

    function getReviewerStake(bytes32 paperId, address reviewer) external view returns (ReviewerStake memory) {
        return reviewerStakes[paperId][reviewer];
    }
}
