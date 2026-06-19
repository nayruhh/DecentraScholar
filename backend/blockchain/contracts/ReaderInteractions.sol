// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./OwnableLite.sol";

interface IPaperRegistryPublicationView {
    function isPublished(bytes32 paperId) external view returns (bool);
}

contract ReaderInteractions is OwnableLite {
    uint8 public constant DOWNLOAD_LIMIT = 3;
    uint64 public constant DOWNLOAD_WINDOW = 1 days;

    struct PaperStats {
        uint64 reads;
        uint64 downloads;
        uint32 ratingCount;
        uint32 ratingTotalHalfSteps;
    }

    struct DownloadPolicy {
        bool allowed;
        uint8 remaining;
        uint8 recentDownloads;
        uint64 nextAvailableAt;
    }

    struct DownloadTracker {
        uint64[DOWNLOAD_LIMIT] timestamps;
        uint8 count;
    }

    IPaperRegistryPublicationView public immutable registry;

    mapping(bytes32 => PaperStats) private stats;
    mapping(bytes32 => mapping(address => bool)) public bookmarks;
    mapping(bytes32 => mapping(address => uint8)) public userRatings;
    mapping(bytes32 => mapping(address => DownloadTracker)) private downloadTrackers;

    event BookmarkUpdated(bytes32 indexed paperId, address indexed reader, bool saved);
    event ReadRecorded(bytes32 indexed paperId, address indexed reader, uint64 totalReads);
    event RatingSubmitted(
        bytes32 indexed paperId,
        address indexed reader,
        uint8 halfSteps,
        uint32 ratingCount,
        uint32 ratingTotalHalfSteps
    );
    event DownloadRegistered(
        bytes32 indexed paperId,
        address indexed reader,
        uint64 totalDownloads,
        uint8 remaining
    );

    error PaperNotPublished();
    error InvalidRating();
    error DownloadLimitReached(uint64 nextAvailableAt);

    constructor(address initialOwner, address registryAddress) OwnableLite(initialOwner) {
        registry = IPaperRegistryPublicationView(registryAddress);
    }

    function setBookmark(bytes32 paperId, bool saved) external {
        _requirePublished(paperId);
        bookmarks[paperId][msg.sender] = saved;
        emit BookmarkUpdated(paperId, msg.sender, saved);
    }

    function recordRead(bytes32 paperId) external {
        _requirePublished(paperId);
        stats[paperId].reads += 1;
        emit ReadRecorded(paperId, msg.sender, stats[paperId].reads);
    }

    function submitRating(bytes32 paperId, uint8 halfSteps) external {
        _requirePublished(paperId);
        if (halfSteps < 1 || halfSteps > 10) revert InvalidRating();

        PaperStats storage paperStats = stats[paperId];
        uint8 previousRating = userRatings[paperId][msg.sender];

        if (previousRating == 0) {
            paperStats.ratingCount += 1;
            paperStats.ratingTotalHalfSteps += halfSteps;
        } else {
            paperStats.ratingTotalHalfSteps =
                paperStats.ratingTotalHalfSteps -
                previousRating +
                halfSteps;
        }

        userRatings[paperId][msg.sender] = halfSteps;

        emit RatingSubmitted(
            paperId,
            msg.sender,
            halfSteps,
            paperStats.ratingCount,
            paperStats.ratingTotalHalfSteps
        );
    }

    function registerDownload(bytes32 paperId) external {
        _requirePublished(paperId);

        DownloadTracker storage tracker = downloadTrackers[paperId][msg.sender];
        uint64 nextAvailableAt = _compactTracker(tracker);
        if (tracker.count >= DOWNLOAD_LIMIT) revert DownloadLimitReached(nextAvailableAt);

        tracker.timestamps[tracker.count] = uint64(block.timestamp);
        tracker.count += 1;

        stats[paperId].downloads += 1;

        emit DownloadRegistered(
            paperId,
            msg.sender,
            stats[paperId].downloads,
            DOWNLOAD_LIMIT - tracker.count
        );
    }

    function getPaperStats(bytes32 paperId) external view returns (PaperStats memory) {
        return stats[paperId];
    }

    function getAverageRatingHalfSteps(bytes32 paperId) external view returns (uint256) {
        PaperStats memory paperStats = stats[paperId];
        if (paperStats.ratingCount == 0) return 0;
        return paperStats.ratingTotalHalfSteps / paperStats.ratingCount;
    }

    function getDownloadPolicy(bytes32 paperId, address reader) external view returns (DownloadPolicy memory) {
        DownloadTracker memory tracker = downloadTrackers[paperId][reader];
        (uint8 activeCount, uint64 nextAvailableAt) = _activeDownloadState(tracker);

        return DownloadPolicy({
            allowed: activeCount < DOWNLOAD_LIMIT,
            remaining: DOWNLOAD_LIMIT - activeCount,
            recentDownloads: activeCount,
            nextAvailableAt: nextAvailableAt
        });
    }

    function _requirePublished(bytes32 paperId) internal view {
        if (!registry.isPublished(paperId)) revert PaperNotPublished();
    }

    function _compactTracker(DownloadTracker storage tracker) internal returns (uint64 nextAvailableAt) {
        uint64[DOWNLOAD_LIMIT] memory fresh;
        uint8 activeCount;
        uint64 cutoff = uint64(block.timestamp) - DOWNLOAD_WINDOW;

        for (uint8 i = 0; i < tracker.count; i++) {
            uint64 timestamp = tracker.timestamps[i];
            if (timestamp > cutoff) {
                fresh[activeCount] = timestamp;
                activeCount += 1;
            }
        }

        for (uint8 j = 0; j < DOWNLOAD_LIMIT; j++) {
            tracker.timestamps[j] = fresh[j];
        }
        tracker.count = activeCount;

        if (activeCount >= DOWNLOAD_LIMIT) {
            nextAvailableAt = fresh[0] + DOWNLOAD_WINDOW;
        }
    }

    function _activeDownloadState(DownloadTracker memory tracker) internal view returns (uint8 activeCount, uint64 nextAvailableAt) {
        uint64 cutoff = uint64(block.timestamp) - DOWNLOAD_WINDOW;
        uint64 earliestActive;

        for (uint8 i = 0; i < tracker.count; i++) {
            uint64 timestamp = tracker.timestamps[i];
            if (timestamp > cutoff) {
                if (activeCount == 0 || timestamp < earliestActive) {
                    earliestActive = timestamp;
                }
                activeCount += 1;
            }
        }

        if (activeCount >= DOWNLOAD_LIMIT) {
            nextAvailableAt = earliestActive + DOWNLOAD_WINDOW;
        }
    }
}
