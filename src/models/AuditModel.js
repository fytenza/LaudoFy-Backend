const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const AuditLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Usuario',
        default: null // Alterado para permitir null para ações sem usuário autenticado
    },
    action: {
        type: String,
        required: true,
        enum: ['create', 'update', 'delete', 'login', 'logout', 'other', 'login_failed', 'refresh_token', 'create_failed', 'refresh_token_failed', 'upload_signed', 'recreate', 'forgot_password', 'forgot_password_failed', 'reset_password', 'password_reset_failed', 'forgot_password_request', 'password_reset_invalid_token', 'password_reset_success']
    },
    description: {
        type: String,
        required: true
    },
    collectionName: {
        type: String,
        required: true
    },
    documentId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
    },
    before: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    after: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    ip: {
        type: String,
        required: true
    },
    userAgent: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    versionKey: false
});

AuditLogSchema.index({ userId: 1 });
AuditLogSchema.index({ collectionName: 1 }); // Corrigido de 'collection' para 'collectionName'
AuditLogSchema.index({ documentId: 1 });
AuditLogSchema.index({ timestamp: -1 });
AuditLogSchema.plugin(mongoosePaginate);

module.exports = mongoose.model('AuditLog', AuditLogSchema, 'audit_logs'); // Nome mais descritivo e collection name explícito