const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/crypto');

const PacienteSchema = new mongoose.Schema({
    nome: {
        type: String,
        required: true,
        trim: true
    },
    cpf: {
        type: String,
        unique: true,
        required: true,
        set: function(v) {
            if (!v) return v;
            const cleaned = v.toString().replace(/\D/g, '');
            return encrypt(cleaned);
        },
        get: function(v) {
            const decrypted = decrypt(v);
            return decrypted || v; // Retorna o valor original se a descriptografia falhar
        }
    },
    dataNascimento: {
        type: String,
        required: true,
        set: function(v) {
            if (!v) return v;
            try {
                // Extrai diretamente os componentes da data (YYYY-MM-DD)
                if (typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    return encrypt(v); // Já está no formato correto
                }
                
                const date = new Date(v);
                if (isNaN(date)) return v;
                
                // Formata como YYYY-MM-DD independente do fuso horário
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                
                return encrypt(`${year}-${month}-${day}`);
            } catch {
                return v;
            }
        },
        get: function(v) {
            const decrypted = decrypt(v);
            if (!decrypted) return v;
            
            // Garante que retorna no formato YYYY-MM-DD
            if (decrypted.match(/^\d{4}-\d{2}-\d{2}$/)) {
                return decrypted;
            }
            
            // Se não estiver no formato esperado, tenta converter
            try {
                const date = new Date(decrypted);
                if (isNaN(date)) return decrypted;
                
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                
                return `${year}-${month}-${day}`;
            } catch {
                return decrypted;
            }
        }
    },
    endereco: {
        type: String,
        required: true,
        set: function(v) {
            return v ? encrypt(v.trim()) : v;
        },
        get: function(v) {
            const decrypted = decrypt(v);
            return decrypted || v;
        }
    },
    telefone: {
        type: String,
        required: true,
        set: function(v) {
            if (!v) return v;
            const cleaned = v.toString().replace(/\D/g, '');
            return encrypt(cleaned);
        },
        get: function(v) {
            const decrypted = decrypt(v);
            return decrypted || v;
        }
    },
    email: {
        type: String,
        unique: false,
        lowercase: true,
        trim: true
    },
    dataCriacao: {
        type: Date,
        default: Date.now,
        immutable: true
    },
    dataAtualizacao: {
        type: Date,
        default: Date.now
    }
}, {
    versionKey: false,
    toJSON: { 
        getters: true,
        transform: function(doc, ret) {
            delete ret.__v;
            delete ret.dataAtualizacao;
            return ret;
        }
    },
    toObject: { getters: true }
});

// Middleware para atualizar dataAtualizacao
PacienteSchema.pre('save', function(next) {
    this.dataAtualizacao = new Date();
    next();
});

module.exports = mongoose.model('Paciente', PacienteSchema);