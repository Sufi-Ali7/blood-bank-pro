const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');

const router = express.Router();

function createToken(user) {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      email: user.email
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authResponse(user) {
  return {
    _id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    bloodGroup: user.bloodGroup,
    role: user.role,
    city: user.city,
    state: user.state,
    address: user.address,
    bio: user.bio,
    isAvailable: user.isAvailable,
    isEligible: user.isEligible,
    isEmailVerified: user.isEmailVerified,
    isPhoneVerified: user.isPhoneVerified
  };
}

// Register
router.post('/register', async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      bloodGroup,
      role,
      password,
      city,
      state,
      latitude,
      longitude,
      address
    } = req.body;

    if (!firstName || !lastName || !email || !phone || !password) {
      return res.status(400).json({ message: 'All required fields are mandatory' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const emailVerificationToken = crypto.randomBytes(20).toString('hex');
    const phoneOtp = Math.floor(100000 + Math.random() * 900000).toString();

    const user = await User.create({
      firstName,
      lastName,
      email: email.toLowerCase(),
      phone,
      bloodGroup: bloodGroup || null,
      role: role || 'donor',
      password: hashedPassword,
      city: city || 'lucknow',
      state: state || 'uttar pradesh',
      address: address || '',
      isAvailable: true,
      isEligible: true,
      isBlocked: false,
      emailVerificationToken,
      phoneOtp,
      phoneOtpExpires: new Date(Date.now() + 10 * 60 * 1000),
      location: {
        type: 'Point',
        coordinates: [
          Number(longitude) || 80.9462,
          Number(latitude) || 26.8467
        ]
      },
      notifications: [
        {
          title: 'Welcome',
          message: 'Your account has been created successfully.',
          type: 'success'
        }
      ]
    });

    const token = createToken(user);

    return res.status(201).json({
      message: 'Registration successful',
      token,
      user: authResponse(user),
      emailVerificationToken,
      phoneOtp
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email: email?.toLowerCase() });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    if (user.isBlocked) {
      return res.status(403).json({ message: 'Your account is blocked by admin' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const token = createToken(user);

    return res.json({
      message: 'Login successful',
      token,
      user: authResponse(user)
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Server error' });
  }
});

// Forgot password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email: email?.toLowerCase() });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const resetPasswordToken = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = resetPasswordToken;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    return res.json({
      message: 'Reset token generated',
      resetPasswordToken
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Server error' });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;

    user.notifications.push({
      title: 'Password Updated',
      message: 'Your password has been changed successfully.',
      type: 'success'
    });

    await user.save();

    return res.json({ message: 'Password reset successful' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Server error' });
  }
});

// Send email verification token
router.post('/send-email-token', async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email: email?.toLowerCase() });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const emailVerificationToken = crypto.randomBytes(20).toString('hex');
    user.emailVerificationToken = emailVerificationToken;
    await user.save();

    return res.json({
      message: 'Email verification token generated',
      emailVerificationToken
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Server error' });
  }
});

// Verify email
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;

    const user = await User.findOne({ emailVerificationToken: token });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email verification token' });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    await user.save();

    return res.json({
      message: 'Email verified successfully',
      user: authResponse(user)
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Server error' });
  }
});

// Send phone OTP
router.post('/send-phone-otp', async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email: email?.toLowerCase() });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const phoneOtp = Math.floor(100000 + Math.random() * 900000).toString();
    user.phoneOtp = phoneOtp;
    user.phoneOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    return res.json({
      message: 'Phone OTP generated',
      phoneOtp
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Server error' });
  }
});

// Verify phone OTP
router.post('/verify-phone-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email: email?.toLowerCase() });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.phoneOtp || !user.phoneOtpExpires || user.phoneOtpExpires < new Date()) {
      return res.status(400).json({ message: 'OTP expired or not found' });
    }

    if (user.phoneOtp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    user.isPhoneVerified = true;
    user.phoneOtp = null;
    user.phoneOtpExpires = null;
    await user.save();

    return res.json({
      message: 'Phone verified successfully',
      user: authResponse(user)
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Server error' });
  }
});


// Get current user
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: 'No token' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      user: authResponse(user)
    });

  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
});


// Update profile
router.patch('/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ message: 'No token' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.firstName = req.body.firstName || user.firstName;
    user.lastName = req.body.lastName || user.lastName;
    user.phone = req.body.phone || user.phone;
    user.city = req.body.city || user.city;
    user.address = req.body.address || user.address;
    user.bio = req.body.bio || user.bio;

    await user.save();

    res.json({
      message: 'Profile updated',
      user: authResponse(user)
    });

  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
});


module.exports = router;