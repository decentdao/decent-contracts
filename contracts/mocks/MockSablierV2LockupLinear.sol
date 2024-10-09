// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UD60x18} from "@prb/math/src/UD60x18.sol";
import {ISablierV2NFTDescriptor} from "../interfaces/sablier/full/ISablierV2NFTDescriptor.sol";
import {ISablierV2Lockup} from "../interfaces/sablier/full/ISablierV2Lockup.sol";
import {LockupLinear, Lockup} from "../interfaces/sablier/full/types/DataTypes.sol";

contract MockSablierV2LockupLinear is ISablierV2Lockup {
    // Define the Stream struct here
    struct Stream {
        address sender;
        address recipient;
        uint128 totalAmount;
        address asset;
        bool cancelable;
        bool transferable;
        uint40 startTime;
        uint40 cliffTime;
        uint40 endTime;
    }

    mapping(uint256 => Stream) public streams;
    uint256 public nextStreamId = 1;

    // Add this event declaration at the contract level
    event StreamCreated(
        uint256 streamId,
        address indexed sender,
        address indexed recipient,
        uint128 totalAmount,
        address indexed asset,
        bool cancelable,
        bool transferable,
        uint40 startTime,
        uint40 cliffTime,
        uint40 endTime
    );

    function createWithTimestamps(
        LockupLinear.CreateWithTimestamps calldata params
    ) external returns (uint256 streamId) {
        require(
            params.asset.transferFrom(
                msg.sender,
                address(this),
                params.totalAmount
            ),
            "Token transfer failed"
        );

        streamId = nextStreamId++;
        streams[streamId] = Stream({
            sender: params.sender,
            recipient: params.recipient,
            totalAmount: params.totalAmount,
            asset: address(params.asset),
            cancelable: params.cancelable,
            transferable: params.transferable,
            startTime: params.timestamps.start,
            cliffTime: params.timestamps.cliff,
            endTime: params.timestamps.end
        });

        // Emit the StreamCreated event
        emit StreamCreated(
            streamId,
            params.sender,
            params.recipient,
            params.totalAmount,
            address(params.asset),
            params.cancelable,
            params.transferable,
            params.timestamps.start,
            params.timestamps.cliff,
            params.timestamps.end
        );

        return streamId;
    }

    function getStream(uint256 streamId) external view returns (Stream memory) {
        return streams[streamId];
    }

    function withdrawableAmountOf(
        uint256 streamId
    ) public view returns (uint128) {
        Stream memory stream = streams[streamId];
        if (block.timestamp <= stream.startTime) {
            return 0;
        }
        if (block.timestamp >= stream.endTime) {
            return stream.totalAmount;
        }
        return
            uint128(
                (stream.totalAmount * (block.timestamp - stream.startTime)) /
                    (stream.endTime - stream.startTime)
            );
    }

    function withdraw(uint256 streamId, uint128 amount) external {
        Stream storage stream = streams[streamId];
        require(msg.sender == stream.recipient, "Only recipient can withdraw");
        require(
            amount <= withdrawableAmountOf(streamId),
            "Insufficient withdrawable amount"
        );

        stream.totalAmount -= amount;
        IERC20(stream.asset).transfer(stream.recipient, amount);
    }

    function cancel(uint256 streamId) external {
        Stream memory stream = streams[streamId];
        require(stream.cancelable, "Stream is not cancelable");
        require(msg.sender == stream.sender, "Only sender can cancel");

        uint128 withdrawableAmount = withdrawableAmountOf(streamId);
        uint128 refundAmount = stream.totalAmount - withdrawableAmount;

        delete streams[streamId];

        if (withdrawableAmount > 0) {
            IERC20(stream.asset).transfer(stream.recipient, withdrawableAmount);
        }
        if (refundAmount > 0) {
            IERC20(stream.asset).transfer(stream.sender, refundAmount);
        }
    }

    function renounce(uint256 streamId) external {
        Stream memory stream = streams[streamId];
        require(msg.sender == stream.recipient, "Only recipient can renounce");

        uint128 withdrawableAmount = withdrawableAmountOf(streamId);
        uint128 refundAmount = stream.totalAmount - withdrawableAmount;

        delete streams[streamId];

        if (withdrawableAmount > 0) {
            IERC20(stream.asset).transfer(stream.recipient, withdrawableAmount);
        }
        if (refundAmount > 0) {
            IERC20(stream.asset).transfer(stream.sender, refundAmount);
        }
    }

    function transferFrom(uint256 streamId, address recipient) external {
        Stream storage stream = streams[streamId];
        require(stream.transferable, "Stream is not transferable");
        require(
            msg.sender == stream.recipient,
            "Only current recipient can transfer"
        );

        stream.recipient = recipient;
    }

    function withdrawMax(
        uint256 streamId,
        address to
    ) external override returns (uint128 withdrawnAmount) {
        withdrawnAmount = withdrawableAmountOf(streamId);
        require(withdrawnAmount > 0, "No withdrawable amount");

        Stream storage stream = streams[streamId];
        stream.totalAmount -= withdrawnAmount;
        IERC20(stream.asset).transfer(to, withdrawnAmount);
        emit WithdrawFromLockupStream(
            streamId,
            to,
            IERC20(stream.asset),
            withdrawnAmount
        );
    }

    function getAsset(
        uint256 streamId
    ) external view override returns (IERC20) {}

    function getDepositedAmount(
        uint256 streamId
    ) external view override returns (uint128) {}

    function getEndTime(
        uint256 streamId
    ) external view override returns (uint40) {}

    function getRecipient(
        uint256 streamId
    ) external view override returns (address) {}

    function getSender(
        uint256 streamId
    ) external view override returns (address) {}

    function getStartTime(
        uint256 streamId
    ) external view override returns (uint40) {}

    function isCancelable(
        uint256 streamId
    ) external view override returns (bool) {}

    function isTransferable(
        uint256 streamId
    ) external view override returns (bool) {}

    function refundableAmountOf(
        uint256 streamId
    ) external view override returns (uint128) {}

    function streamedAmountOf(
        uint256 streamId
    ) external view override returns (uint128) {}

    function wasCanceled(
        uint256 streamId
    ) external pure override returns (bool) {}

    function withdrawMultiple(
        uint256[] calldata streamIds,
        uint128[] calldata amounts
    ) external {}

    function withdrawMaxAndTransfer(
        uint256 streamId,
        address newRecipient
    ) external returns (uint128 withdrawnAmount) {}

    function getRefundedAmount(
        uint256 streamId
    ) external view returns (uint128 refundedAmount) {}

    function getWithdrawnAmount(
        uint256 streamId
    ) external view returns (uint128 withdrawnAmount) {}

    function isAllowedToHook(
        address recipient
    ) external view returns (bool result) {}

    function isCold(uint256 streamId) external view returns (bool result) {}

    function isDepleted(uint256 streamId) external view returns (bool result) {}

    function isStream(uint256 streamId) external view returns (bool result) {}

    function isWarm(uint256 streamId) external view returns (bool result) {}

    function getBrokerFee(uint256 streamId) external view returns (uint256) {}

    function getBroker(uint256 streamId) external view returns (address) {}

    function getBrokerFeeBips(
        uint256 streamId
    ) external view returns (uint256) {}

    function admin() external view override returns (address) {}

    function transferAdmin(address newAdmin) external override {}

    function supportsInterface(
        bytes4 interfaceId
    ) external view override returns (bool) {}

    function balanceOf(
        address owner
    ) external view override returns (uint256 balance) {}

    function ownerOf(
        uint256 tokenId
    ) external view override returns (address owner) {}

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes calldata data
    ) external override {}

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId
    ) external override {}

    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) external override {}

    function approve(address to, uint256 tokenId) external override {}

    function setApprovalForAll(
        address operator,
        bool _approved
    ) external override {}

    function getApproved(
        uint256 tokenId
    ) external view override returns (address operator) {}

    function isApprovedForAll(
        address owner,
        address operator
    ) external view override returns (bool) {}

    function name() external view override returns (string memory) {}

    function symbol() external view override returns (string memory) {}

    function tokenURI(
        uint256 tokenId
    ) external view override returns (string memory) {}

    function MAX_BROKER_FEE() external view override returns (UD60x18) {}

    function nftDescriptor()
        external
        view
        override
        returns (ISablierV2NFTDescriptor)
    {}

    function statusOf(
        uint256 streamId
    ) external view override returns (Lockup.Status status) {}

    function allowToHook(address recipient) external override {}

    function burn(uint256 streamId) external override {}

    function cancelMultiple(uint256[] calldata streamIds) external override {}

    function setNFTDescriptor(
        ISablierV2NFTDescriptor newNFTDescriptor
    ) external override {}

    function withdraw(
        uint256 streamId,
        address to,
        uint128 amount
    ) external override {}
}
