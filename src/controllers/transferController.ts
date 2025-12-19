// ============= src/controllers/transferController.ts (WITH PASSKEY VERIFICATION) =============
import { Request, Response } from 'express';
import crypto from 'crypto';
import User from '../models/User';
import Transfer from '../models/Transfer';
import InviteCode from '../models/InviteCode';
import Contact from '../models/Contact';
import { sendUSDCWithPaymaster } from '../services/paymasterService';
import { NetworkType } from '../services/walletService';
import { getUSDCBalance } from '../services/walletService';

const LINK_EXPIRY_DAYS = 30;

function generateLinkCode(): string {
  return `ABOKI_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`.toUpperCase();
}

/**
 * MIDDLEWARE: Verify transaction has been verified with passkey
 * This ensures user re-authenticated before sending
 */
export const verifyTransactionPasskey = async (req: Request, res: Response, next: Function): Promise<void> => {
  try {
    const transactionVerified = (req as any).transactionVerified;
    
    if (!transactionVerified) {
      res.status(401).json({
        success: false,
        error: 'Transaction must be verified with passkey first',
        requiresPasskeyVerification: true
      });
      return;
    }

    next();
  } catch (error) {
    console.error('❌ Error verifying transaction passkey:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error'
    });
  }
};

/**
 * @desc    Validate if username exists in the system
 * @route   GET /api/transfer/validate-username/:username
 * @access  Private
 */
export const validateUsername = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username } = req.params;

    if (!username || username.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: 'Username is required'
      });
      return;
    }

    const user = await User.findOne({ 
      username: username.toLowerCase() 
    }).select('username name');

    if (!user) {
      res.status(404).json({
        success: false,
        error: `User @${username} not found`,
        exists: false
      });
      return;
    }

    const requestingUser = await User.findById(req.user?.id);
    if (requestingUser?._id.toString() === user._id.toString()) {
      res.status(400).json({
        success: false,
        error: 'Cannot validate your own username',
        exists: true
      });
      return;
    }

    res.status(200).json({
      success: true,
      exists: true,
      data: {
        username: user.username,
        name: user.name
      }
    });
  } catch (error: any) {
    console.error('❌ Error validating username:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Get my contacts (users I've interacted with)
 * @route   GET /api/transfer/contacts
 * @access  Private
 */
export const getMyContacts = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    
    const contacts = await Contact.find({ userId })
      .populate('contactUser', 'username name wallet')
      .sort({ lastInteractedAt: -1 });

    const formattedContacts = contacts.map(c => {
      const contactUser = c.contactUser as any;
      return {
        id: c._id,
        username: contactUser?.username,
        name: contactUser?.name,
        address: c.address,
        interactionCount: c.interactionCount,
        lastInteractedAt: c.lastInteractedAt,
        transferCount: c.transferCount,
        totalAmountTransferred: c.totalAmountTransferred
      };
    });

    res.status(200).json({
      success: true,
      count: formattedContacts.length,
      data: formattedContacts
    });
  } catch (error: any) {
    console.error('❌ Error fetching contacts:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Get recent contacts (quick send suggestions)
 * @route   GET /api/transfer/contacts/recent
 * @access  Private
 */
export const getRecentContacts = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 5;

    const contacts = await Contact.find({ userId })
      .populate('contactUser', 'username name')
      .sort({ lastInteractedAt: -1 })
      .limit(limit);

    const formattedContacts = contacts.map(c => {
      const contactUser = c.contactUser as any;
      return {
        username: contactUser?.username,
        name: contactUser?.name,
        lastInteractedAt: c.lastInteractedAt
      };
    });

    res.status(200).json({
      success: true,
      count: formattedContacts.length,
      data: formattedContacts
    });
  } catch (error: any) {
    console.error('❌ Error fetching recent contacts:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Send USDC to another user by username (REQUIRES PASSKEY VERIFICATION)
 * @route   POST /api/transfer/send/username
 * @access  Private - Requires passkey verification
 */
export const sendToUsername = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, amount, message } = req.body;

    // ✅ VERIFY PASSKEY SIGNATURE
    const passkeyVerified = (req as any).passkeyVerified;
    if (!passkeyVerified) {
      res.status(401).json({
        success: false,
        error: 'Transaction must be verified with passkey first',
        requiresPasskeyVerification: true
      });
      return;
    }

    if (!username || !amount) {
      res.status(400).json({
        success: false,
        error: 'Please provide username and amount'
      });
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      res.status(400).json({
        success: false,
        error: 'Invalid amount'
      });
      return;
    }

    const sender = await User.findById(req.user?.id).select('+wallet.encryptedWalletData');
    if (!sender || !sender.wallet) {
      res.status(404).json({
        success: false,
        error: 'Sender wallet not found'
      });
      return;
    }

    if (!sender.wallet.encryptedWalletData) {
      res.status(400).json({
        success: false,
        error: 'Wallet not properly configured'
      });
      return;
    }

    // VALIDATE: Check if recipient username exists
    const recipient = await User.findOne({ username: username.toLowerCase() });
    if (!recipient) {
      res.status(404).json({
        success: false,
        error: `User @${username} not found in our system`,
        exists: false
      });
      return;
    }

    if (!recipient.wallet) {
      res.status(404).json({
        success: false,
        error: `User @${username} doesn't have a wallet yet`
      });
      return;
    }

    if (sender._id.equals(recipient._id)) {
      res.status(400).json({
        success: false,
        error: 'Cannot send to yourself'
      });
      return;
    }

    const senderAddress = sender.wallet.smartAccountAddress || sender.wallet.ownerAddress;
    const network = (sender.wallet.network || 'base-mainnet') as NetworkType;
    const balance = await getUSDCBalance(senderAddress, network);

    if (parseFloat(balance.balance) < amountNum) {
      res.status(400).json({
        success: false,
        error: `Insufficient balance. You have ${balance.balance} USDC`
      });
      return;
    }

    const amountInWei = (amountNum * 1e6).toString();
    const recipientAddress = recipient.wallet.smartAccountAddress || recipient.wallet.ownerAddress;

    const transfer = await Transfer.create({
      fromUser: sender._id,
      fromUsername: sender.username,
      fromAddress: senderAddress,
      toUser: recipient._id,
      toUsername: recipient.username,
      toAddress: recipientAddress,
      amount: amountNum,
      amountInWei,
      transferType: 'USERNAME',
      status: 'PENDING',
      message,
      network,
      verifiedWithPasskey: true, // ✅ Mark as passkey-verified
      verificationTimestamp: new Date()
    });

    console.log(`💸 Username transfer (passkey verified): @${sender.username} → @${recipient.username} (${amountNum} USDC)`);

    try {
      const privateKey = sender.wallet.encryptedWalletData;
      
      const result = await sendUSDCWithPaymaster(
        privateKey,
        recipientAddress,
        amountNum.toString(),
        network
      );

      transfer.status = 'COMPLETED';
      transfer.transactionHash = result.transactionHash;
      await transfer.save();

      // CONTACT TRACKING: Update or create contact record
      await updateContact(sender._id, recipient._id, recipient.username, recipientAddress, amountNum);

      console.log(`✅ Passkey-verified transfer completed: ${result.transactionHash}`);

      res.status(200).json({
        success: true,
        message: `Successfully sent ${amountNum} USDC to @${recipient.username}`,
        data: {
          transferId: transfer._id,
          from: sender.username,
          to: recipient.username,
          amount: amountNum,
          transactionHash: result.transactionHash,
          explorerUrl: result.explorerUrl,
          gasSponsored: result.gasSponsored,
          message: transfer.message,
          verifiedWithPasskey: true
        }
      });
    } catch (txError: any) {
      transfer.status = 'FAILED';
      transfer.failureReason = txError.message;
      await transfer.save();

      res.status(500).json({
        success: false,
        error: 'Transfer failed',
        details: txError.message
      });
    }
  } catch (error: any) {
    console.error('❌ Error in sendToUsername:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Send USDC to external wallet (REQUIRES PASSKEY VERIFICATION)
 * @route   POST /api/transfer/send/external
 * @access  Private - Requires passkey verification
 */
export const sendToExternal = async (req: Request, res: Response): Promise<void> => {
  try {
    const { address, amount, message } = req.body;

    // ✅ VERIFY PASSKEY SIGNATURE
    const passkeyVerified = (req as any).passkeyVerified;
    if (!passkeyVerified) {
      res.status(401).json({
        success: false,
        error: 'Transaction must be verified with passkey first',
        requiresPasskeyVerification: true
      });
      return;
    }

    if (!address || !amount) {
      res.status(400).json({
        success: false,
        error: 'Please provide address and amount'
      });
      return;
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      res.status(400).json({
        success: false,
        error: 'Invalid Ethereum address'
      });
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      res.status(400).json({
        success: false,
        error: 'Invalid amount'
      });
      return;
    }

    const sender = await User.findById(req.user?.id).select('+wallet.encryptedWalletData');
    if (!sender || !sender.wallet) {
      res.status(404).json({
        success: false,
        error: 'Wallet not found'
      });
      return;
    }

    if (!sender.wallet.encryptedWalletData) {
      res.status(400).json({
        success: false,
        error: 'Wallet not properly configured'
      });
      return;
    }

    const senderAddress = sender.wallet.smartAccountAddress || sender.wallet.ownerAddress;
    const network = (sender.wallet.network || 'base-mainnet') as NetworkType;
    const balance = await getUSDCBalance(senderAddress, network);

    if (parseFloat(balance.balance) < amountNum) {
      res.status(400).json({
        success: false,
        error: `Insufficient balance. You have ${balance.balance} USDC`
      });
      return;
    }

    const amountInWei = (amountNum * 1e6).toString();

    const transfer = await Transfer.create({
      fromUser: sender._id,
      fromUsername: sender.username,
      fromAddress: senderAddress,
      toAddress: address,
      amount: amountNum,
      amountInWei,
      transferType: 'EXTERNAL',
      status: 'PENDING',
      message,
      network,
      verifiedWithPasskey: true, // ✅ Mark as passkey-verified
      verificationTimestamp: new Date()
    });

    console.log(`💸 External transfer (passkey verified): @${sender.username} → ${address} (${amountNum} USDC)`);

    try {
      const privateKey = sender.wallet.encryptedWalletData;
      
      const result = await sendUSDCWithPaymaster(
        privateKey,
        address,
        amountNum.toString(),
        network
      );

      transfer.status = 'COMPLETED';
      transfer.transactionHash = result.transactionHash;
      await transfer.save();

      console.log(`✅ Passkey-verified transfer completed: ${result.transactionHash}`);

      res.status(200).json({
        success: true,
        message: `Successfully sent ${amountNum} USDC`,
        data: {
          transferId: transfer._id,
          from: sender.username,
          to: address,
          amount: amountNum,
          transactionHash: result.transactionHash,
          explorerUrl: result.explorerUrl,
          gasSponsored: result.gasSponsored,
          verifiedWithPasskey: true
        }
      });
    } catch (txError: any) {
      transfer.status = 'FAILED';
      transfer.failureReason = txError.message;
      await transfer.save();

      res.status(500).json({
        success: false,
        error: 'Transfer failed',
        details: txError.message
      });
    }
  } catch (error: any) {
    console.error('❌ Error in sendToExternal:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Create a payment link (with embedded invite code from sender)
 * @route   POST /api/transfer/create-link
 * @access  Private
 */
export const createPaymentLink = async (req: Request, res: Response): Promise<void> => {
  try {
    const { amount, message } = req.body;

    if (!amount) {
      res.status(400).json({
        success: false,
        error: 'Please provide amount'
      });
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      res.status(400).json({
        success: false,
        error: 'Invalid amount'
      });
      return;
    }

    const sender = await User.findById(req.user?.id);
    if (!sender || !sender.wallet) {
      res.status(404).json({
        success: false,
        error: 'Wallet not found'
      });
      return;
    }

    const senderAddress = sender.wallet.smartAccountAddress || sender.wallet.ownerAddress;
    const network = (sender.wallet.network || 'base-mainnet') as NetworkType;
    const balance = await getUSDCBalance(senderAddress, network);

    if (parseFloat(balance.balance) < amountNum) {
      res.status(400).json({
        success: false,
        error: `Insufficient balance. You have ${balance.balance} USDC`
      });
      return;
    }

    const senderInviteCode = await InviteCode.findOne({ createdBy: sender._id });

    const linkCode = generateLinkCode();
    const linkExpiry = new Date();
    linkExpiry.setDate(linkExpiry.getDate() + LINK_EXPIRY_DAYS);

    const amountInWei = (amountNum * 1e6).toString();

    const transfer = await Transfer.create({
      fromUser: sender._id,
      fromUsername: sender.username,
      fromAddress: senderAddress,
      amount: amountNum,
      amountInWei,
      transferType: 'LINK',
      status: 'PENDING',
      linkCode,
      linkExpiry,
      message,
      network,
      pendingClaimByNewUser: true
    });

    const claimUrl = `${process.env.FRONTEND_URL || 'https://aboki.xyz'}/claim/${linkCode}${senderInviteCode ? `?invite=${senderInviteCode.code}` : ''}`;

    console.log(`🔗 Payment link created by @${sender.username}`);
    console.log(`   Amount: ${amountNum} USDC`);
    console.log(`   Code: ${linkCode}`);

    res.status(201).json({
      success: true,
      message: 'Payment link created successfully',
      data: {
        transferId: transfer._id,
        linkCode,
        claimUrl,
        amount: amountNum,
        message: transfer.message,
        inviteCode: senderInviteCode?.code || null,
        expiresAt: linkExpiry,
        status: 'PENDING'
      }
    });
  } catch (error: any) {
    console.error('❌ Error creating payment link:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Get payment link details (PUBLIC - shows invite code)
 * @route   GET /api/transfer/link/:linkCode
 * @access  Public
 */
export const getPaymentLinkDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const { linkCode } = req.params;

    const transfer = await Transfer.findOne({
      linkCode: linkCode.toUpperCase(),
      transferType: 'LINK'
    }).populate('fromUser', 'username name');

    if (!transfer) {
      res.status(404).json({
        success: false,
        error: 'Payment link not found'
      });
      return;
    }

    const senderInviteCode = await InviteCode.findOne({ createdBy: transfer.fromUser._id });

    const isExpired = transfer.linkExpiry && new Date() > transfer.linkExpiry;
    const isClaimed = transfer.status === 'CLAIMED' || transfer.status === 'COMPLETED';

    res.status(200).json({
      success: true,
      data: {
        from: (transfer.fromUser as any).username,
        fromName: (transfer.fromUser as any).name,
        amount: transfer.amount,
        message: transfer.message,
        status: transfer.status,
        isClaimed,
        isExpired,
        claimedBy: transfer.toUsername,
        claimedAt: transfer.claimedAt,
        expiresAt: transfer.linkExpiry,
        transactionHash: transfer.transactionHash,
        inviteCode: senderInviteCode?.code || null,
        requiresSignup: !isClaimed && !isExpired
      }
    });
  } catch (error: any) {
    console.error('❌ Error getting payment link:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Claim payment from link
 * @route   POST /api/transfer/claim/:linkCode
 * @access  Private
 */
export const claimPaymentLink = async (req: Request, res: Response): Promise<void> => {
  try {
    const { linkCode } = req.params;

    const transfer = await Transfer.findOne({
      linkCode: linkCode.toUpperCase(),
      transferType: 'LINK'
    }).populate('fromUser', 'username name');

    if (!transfer) {
      res.status(404).json({
        success: false,
        error: 'Payment link not found'
      });
      return;
    }

    if (transfer.status === 'CLAIMED' || transfer.status === 'COMPLETED') {
      res.status(400).json({
        success: false,
        error: 'This payment link has already been claimed'
      });
      return;
    }

    if (transfer.linkExpiry && new Date() > transfer.linkExpiry) {
      transfer.status = 'CANCELLED';
      await transfer.save();

      res.status(400).json({
        success: false,
        error: 'This payment link has expired'
      });
      return;
    }

    const claimer = await User.findById(req.user?.id).select('wallet');
    if (!claimer || !claimer.wallet) {
      res.status(404).json({
        success: false,
        error: 'Please create a wallet first to claim this payment',
        requiresWallet: true
      });
      return;
    }

    if (transfer.fromUser._id.equals(claimer._id)) {
      res.status(400).json({
        success: false,
        error: 'Cannot claim your own payment link'
      });
      return;
    }

    const sender = await User.findById(transfer.fromUser).select('+wallet.encryptedWalletData');
    if (!sender || !sender.wallet) {
      res.status(404).json({
        success: false,
        error: 'Sender wallet not found'
      });
      return;
    }

    if (!sender.wallet.encryptedWalletData) {
      res.status(500).json({
        success: false,
        error: 'Sender wallet not properly configured'
      });
      return;
    }

    const claimerAddress = claimer.wallet.smartAccountAddress || claimer.wallet.ownerAddress;
    const network = (sender.wallet.network || 'base-mainnet') as NetworkType;

    console.log(`🎁 Claiming payment link`);
    console.log(`   From: @${transfer.fromUsername}`);
    console.log(`   To: @${claimer.username}`);
    console.log(`   Amount: ${transfer.amount} USDC`);

    try {
      const privateKey = sender.wallet.encryptedWalletData;
      
      const result = await sendUSDCWithPaymaster(
        privateKey,
        claimerAddress,
        transfer.amount.toString(),
        network
      );

      transfer.status = 'CLAIMED';
      transfer.toUser = claimer._id;
      transfer.toUsername = claimer.username;
      transfer.toAddress = claimerAddress;
      transfer.transactionHash = result.transactionHash;
      transfer.claimedBy = claimer._id;
      transfer.claimedAt = new Date();
      transfer.pendingClaimByNewUser = false;
      await transfer.save();

      // CONTACT TRACKING: Update sender's contacts
      await updateContact(sender._id, claimer._id, claimer.username, claimerAddress, transfer.amount);

      console.log(`✅ Payment claimed: ${result.transactionHash}`);

      res.status(200).json({
        success: true,
        message: `Successfully claimed ${transfer.amount} USDC!`,
        data: {
          transferId: transfer._id,
          from: transfer.fromUsername,
          amount: transfer.amount,
          transactionHash: result.transactionHash,
          explorerUrl: result.explorerUrl,
          gasSponsored: result.gasSponsored,
          message: transfer.message
        }
      });
    } catch (txError: any) {
      transfer.status = 'FAILED';
      transfer.failureReason = txError.message;
      await transfer.save();

      res.status(500).json({
        success: false,
        error: 'Failed to claim payment',
        details: txError.message
      });
    }
  } catch (error: any) {
    console.error('❌ Error claiming payment:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Get my transfer history
 * @route   GET /api/transfer/history
 * @access  Private
 */
export const getTransferHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;

    const transfers = await Transfer.find({
      $or: [
        { fromUser: userId },
        { toUser: userId },
        { claimedBy: userId }
      ]
    })
      .populate('fromUser', 'username name')
      .populate('toUser', 'username name')
      .sort({ createdAt: -1 })
      .limit(100);

    const formattedTransfers = transfers.map(t => ({
      id: t._id,
      type: t.transferType,
      direction: t.fromUser._id.toString() === userId ? 'SENT' : 'RECEIVED',
      from: (t.fromUser as any).username,
      to: t.toUsername || t.toAddress || 'Link',
      amount: t.amount,
      status: t.status,
      message: t.message,
      transactionHash: t.transactionHash,
      linkCode: t.linkCode,
      verifiedWithPasskey: t.verifiedWithPasskey || false,
      createdAt: t.createdAt,
      claimedAt: t.claimedAt
    }));

    res.status(200).json({
      success: true,
      count: formattedTransfers.length,
      data: formattedTransfers
    });
  } catch (error: any) {
    console.error('❌ Error getting transfer history:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * @desc    Cancel payment link
 * @route   DELETE /api/transfer/link/:linkCode
 * @access  Private
 */
export const cancelPaymentLink = async (req: Request, res: Response): Promise<void> => {
  try {
    const { linkCode } = req.params;

    const transfer = await Transfer.findOne({
      linkCode: linkCode.toUpperCase(),
      fromUser: req.user?.id
    });

    if (!transfer) {
      res.status(404).json({
        success: false,
        error: 'Payment link not found'
      });
      return;
    }

    if (transfer.status !== 'PENDING') {
      res.status(400).json({
        success: false,
        error: `Cannot cancel ${transfer.status.toLowerCase()} transfer`
      });
      return;
    }

    transfer.status = 'CANCELLED';
    await transfer.save();

    res.status(200).json({
      success: true,
      message: 'Payment link cancelled successfully'
    });
  } catch (error: any) {
    console.error('❌ Error cancelling payment link:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server Error'
    });
  }
};

/**
 * HELPER FUNCTION: Update or create contact record
 */
async function updateContact(
  userId: any,
  contactUserId: any,
  contactUsername: string,
  contactAddress: string,
  transferAmount: number
): Promise<void> {
  try {
    const existingContact = await Contact.findOne({
      userId,
      contactUser: contactUserId
    });

    if (existingContact) {
      existingContact.interactionCount += 1;
      existingContact.transferCount += 1;
      existingContact.totalAmountTransferred += transferAmount;
      existingContact.lastInteractedAt = new Date();
      await existingContact.save();
    } else {
      await Contact.create({
        userId,
        contactUser: contactUserId,
        username: contactUsername,
        address: contactAddress,
        interactionCount: 1,
        transferCount: 1,
        totalAmountTransferred: transferAmount,
        lastInteractedAt: new Date()
      });
    }
  } catch (error) {
    console.error('❌ Error updating contact:', error);
  }
}

export default {
  validateUsername,
  getMyContacts,
  getRecentContacts,
  sendToUsername,
  sendToExternal,
  createPaymentLink,
  claimPaymentLink,
  getPaymentLinkDetails,
  getTransferHistory,
  cancelPaymentLink,
  verifyTransactionPasskey
};