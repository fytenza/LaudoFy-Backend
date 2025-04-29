const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/crypto');

const ExameSchema = new mongoose.Schema({
    paciente: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Paciente',
        required: true,
    },
    tipoExame: {
        type: String,
        required: true,
        set: function(v) {
            if (!v) return v;
            if (typeof v === 'string' && v.includes(':')) return v;
            
            const normalizedValue = String(v).trim().toUpperCase();
            const validValues = ['ECG', 'HOLTER', 'ERGOMETRIA', 'OUTRO', 'MAPA'];
            
            if (!validValues.includes(normalizedValue)) {
                throw new Error(`Tipo de exame inválido: ${v}. Valores permitidos: ${validValues.join(', ')}`);
            }
            return encrypt(normalizedValue);
        },
        get: function(v) {
            if (!v) return v;
            const decrypted = decrypt(v);
            return decrypted ? decrypted.charAt(0).toUpperCase() + decrypted.slice(1).toLowerCase() : v;
        }
    },
    dataExame: {
        type: Date,
        default: Date.now,
    },
    arquivo: {
        type: String,
        required: true,
        set: function(v) {
            return v ? encrypt(v.trim()) : v;
        },
        get: function(v) {
            return v ? decrypt(v) : v;
        }
    },
    sintomas: {
        type: String,
        required: true,
        set: function(v) {
            return v ? encrypt(v.trim()) : v;
        },
        get: function(v) {
            return v ? decrypt(v) : v;
        }
    },
    segmentoPR: {
        type: String,
        required: false,
        set: function(v) {
            return v !== undefined && v !== null ? encrypt(v.toString()) : v;
        },
        get: function(v) {
            if (!v) return v;
            const decrypted = decrypt(v);
            return decrypted ? parseFloat(decrypted) : v;
        }
    },
    frequenciaCardiaca: {
        type: String,
        required: false,
        set: function(v) {
            return v !== undefined && v !== null ? encrypt(v.toString()) : v;
        },
        get: function(v) {
            if (!v) return v;
            const decrypted = decrypt(v);
            return decrypted ? parseFloat(decrypted) : v;
        }
    },
    duracaoQRS: {
        type: String,
        required: false,
        set: function(v) {
            return v !== undefined && v !== null ? encrypt(v.toString()) : v;
        },
        get: function(v) {
            if (!v) return v;
            const decrypted = decrypt(v);
            return decrypted ? parseFloat(decrypted) : v;
        }
    },
    eixoMedioQRS: {
        type: String,
        required: false,
        set: function(v) {
            return v !== undefined && v !== null ? encrypt(v.toString()) : v;
        },
        get: function(v) {
            if (!v) return v;
            const decrypted = decrypt(v);
            return decrypted ? parseFloat(decrypted) : v;
        }
    },
    altura: {
        type: String,
        required: false,
        set: function(v) {
            return v !== undefined && v !== null ? encrypt(v.toString()) : v;
        },
        get: function(v) {
            if (!v) return v;
            const decrypted = decrypt(v);
            return decrypted ? parseFloat(decrypted) : v;
        }
    },
    peso: {
        type: String,
        required: false,
        set: function(v) {
            return v !== undefined && v !== null ? encrypt(v.toString()) : v;
        },
        get: function(v) {
            if (!v) return v;
            const decrypted = decrypt(v);
            return decrypted ? parseFloat(decrypted) : v;
        }
    },
    idade: {
        type: String,
        required: false,
        set: function(v) {
            return v !== undefined && v !== null ? encrypt(v.toString()) : v;
        },
        get: function(v) {
            if (!v) return v;
            const decrypted = decrypt(v);
            return decrypted ? parseInt(decrypted) : v;
        }
    },
    status: {
        type: String,
        default: function() { return encrypt('Pendente'); },
        set: function(v) {
            if (!v) return v;
            if (typeof v === 'string' && v.includes(':')) return v;
            
            const normalizedValue = String(v).trim();
            const validValues = ['Pendente', 'Concluído', 'Laudo realizado'];
            
            if (!validValues.includes(normalizedValue)) {
                throw new Error(`Status inválido: ${v}. Valores permitidos: ${validValues.join(', ')}`);
            }
            return encrypt(normalizedValue);
        },
        get: function(v) {
            return v ? decrypt(v) : v;
        }
    },
    tecnico: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Usuario',
        required: true,
    },
    thumbnail: {
        type: String,
        set: function(v) {
            return v ? encrypt(v.trim()) : v;
        },
        get: function(v) {
            return v ? decrypt(v) : v;
        }
    },
}, { 
    timestamps: true,
    toJSON: { 
        getters: true, 
        virtuals: true,
        transform: function(doc, ret) {
            // Aplica manualmente os getters para garantir que funcionem
            if (ret.tipoExame) ret.tipoExame = doc.tipoExame;
            if (ret.status) ret.status = doc.status;
            if (ret.arquivo) ret.arquivo = doc.arquivo;
            if (ret.sintomas) ret.sintomas = doc.sintomas;
            if (ret.thumbnail) ret.thumbnail = doc.thumbnail;
            
            // Campos numéricos
            const numericFields = ['segmentoPR', 'frequenciaCardiaca', 'duracaoQRS', 
                                 'eixoMedioQRS', 'altura', 'peso', 'idade'];
            numericFields.forEach(field => {
                if (ret[field]) ret[field] = doc[field];
            });
            
            return ret;
        }
    },
    toObject: { 
        getters: true, 
        virtuals: true 
    }
});

// Middleware para validação
ExameSchema.pre('save', function (next) {
    const numericFields = [
      'segmentoPR', 'frequenciaCardiaca', 'duracaoQRS',
      'eixoMedioQRS', 'altura', 'peso', 'idade'
    ];
  
    for (const field of numericFields) {
      if (this[field] !== undefined && this[field] !== null) {
        const decrypted = decrypt(this[field]);
        const value = parseFloat(decrypted);
        if (isNaN(value)) {
          throw new Error(`${field} deve ser um número válido`);
        }
      }
    }
    next();
  });
  

module.exports = mongoose.model('Exame', ExameSchema);